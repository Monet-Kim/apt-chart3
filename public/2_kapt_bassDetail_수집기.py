# -*- coding: utf-8 -*-
"""
KAPT 상세정보 수집기
══════════════════════════════════════════════════════════════════
  KaptList/*_list_coord.csv 의 kaptCode
    → getAphusDtlInfoV4 API 호출
    → KaptDetail/*_Details.csv 저장

재실행 동작:
  - API 응답이 기존 데이터와 완전히 동일  → skip (파일 쓰기 없음)
  - API 응답에 변경된 셀이 하나라도 있음  → 해당 행 업데이트
  - 기존 파일에 없던 kaptCode           → 파일 맨 아래에 추가
  - 파일 내 변경/추가가 없으면 파일 재저장하지 않음

버튼:
  수집       → Step 1 (API 수집만)
  R2 업로드  → Step 2 (R2 업로드만)
  전체 실행  → Step 1 → 2

일일 한도:
  1,000,000 회 도달 시 자동 중단
══════════════════════════════════════════════════════════════════
"""

import csv, html, json, logging, pathlib, re, sys, time, traceback
from collections import OrderedDict
from datetime import datetime, timezone

import boto3
import requests

from PyQt6.QtCore  import Qt, QThread, pyqtSignal
from PyQt6.QtGui   import QFont, QTextCursor
from PyQt6.QtWidgets import (
    QApplication, QFrame, QGroupBox, QHBoxLayout, QLabel,
    QMainWindow, QProgressBar, QPushButton,
    QTextEdit, QVBoxLayout, QWidget,
)

# ══════════════════════════════════════════════════════════════════
#  설정
# ══════════════════════════════════════════════════════════════════
SERVICE_KEY = "HcVtWuaWvdDSFSZQtcDh5WXItVvZ9Wof23DGfIzh0fUEGb9v06BprdP6QIPK2rVTVsHKx9i3WgsXWYXOZE4vbg=="
DETAIL_URL  = "http://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusDtlInfoV4"

BASE_DIR    = pathlib.Path(__file__).parent
INPUT_DIR   = BASE_DIR / "KaptList"
OUTPUT_DIR  = BASE_DIR / "KaptDetail"

DAILY_LIMIT = 1_000_000
SLEEP_SEC   = 0.1
RETRIES     = 3

R2_ACCESS_KEY = "71e270652969acf7a661d46404a196c6"
R2_SECRET_KEY = "e0bdd25cd87d66f24a08e7d98387196fa2316bec40d8fe3b0426aa308fa609d4"
R2_ENDPOINT   = "https://485ad5b19488023956187106c5f363d2.r2.cloudflarestorage.com"
R2_BUCKET     = "apt-chart-data"
R2_FOLDER     = "KaptDetail"

LOG_DIR = BASE_DIR / "logs"

def _setup_logger():
    LOG_DIR.mkdir(exist_ok=True)
    log_file = LOG_DIR / f"detail_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    lg = logging.getLogger("detail")
    lg.setLevel(logging.DEBUG)
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S"))
    lg.addHandler(fh)
    return lg

logger = _setup_logger()

DETAIL_KEYS = [
    "kaptCode", "kaptName", "codeMgr", "kaptMgrCnt", "kaptCcompany",
    "codeSec", "kaptdScnt", "kaptdSecCom", "codeClean", "kaptdClcnt",
    "codeGarbage", "codeDisinf", "kaptdDcnt", "disposalType", "codeStr",
    "kaptdEcapa", "codeEcon", "codeEmgr", "codeFalarm", "codeWsupply",
    "codeElev", "kaptdEcnt", "kaptdPcnt", "kaptdPcntu", "codeNet",
    "kaptdCccnt", "welfareFacility", "kaptdWtimebus", "subwayLine",
    "subwayStation", "kaptdWtimesub", "convenientFacility",
    "educationFacility", "groundElChargerCnt", "undergroundElChargerCnt",
    "useYn",
]

# ══════════════════════════════════════════════════════════════════
#  UI 스타일 상수 (1번 수집기와 동일)
# ══════════════════════════════════════════════════════════════════
LEVEL_COLOR = {
    "header": "#6eb0f5",
    "info":   "#c0cfe8",
    "ok":     "#69db7c",
    "warn":   "#ffa94d",
    "skip":   "#5a6a88",
    "data":   "#8fa8c0",
}

# ══════════════════════════════════════════════════════════════════
#  헬퍼
# ══════════════════════════════════════════════════════════════════
def list_input_files():
    return sorted(INPUT_DIR.glob("*_list_coord.csv"))

def output_path(src: pathlib.Path) -> pathlib.Path:
    return OUTPUT_DIR / src.name.replace("_list_coord.csv", "_Details.csv")

def read_kapt_codes(src: pathlib.Path) -> list:
    codes, seen = [], set()
    for enc in ("utf-8-sig", "cp949", "utf-8"):
        try:
            with open(src, encoding=enc, newline="") as fp:
                for row in csv.DictReader(fp):
                    code = (row.get("kaptCode") or "").strip()
                    if code and code not in seen:
                        codes.append(code); seen.add(code)
            return codes
        except (UnicodeDecodeError, KeyError):
            continue
    return []

def load_existing(dst: pathlib.Path) -> OrderedDict:
    result = OrderedDict()
    if not dst.exists(): return result
    for enc in ("utf-8-sig", "cp949", "utf-8"):
        try:
            with open(dst, encoding=enc, newline="") as fp:
                for row in csv.DictReader(fp):
                    code = (row.get("kaptCode") or "").strip()
                    if code:
                        result[code] = {k: (row.get(k) or "") for k in DETAIL_KEYS}
            return result
        except (UnicodeDecodeError, KeyError):
            continue
    return result

def save_csv(dst: pathlib.Path, data: OrderedDict) -> None:
    with open(dst, "w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=DETAIL_KEYS, extrasaction="ignore")
        writer.writeheader()
        for row in data.values():
            writer.writerow(row)

def item_to_row(item: dict) -> dict:
    return {k: str(item.get(k) if item.get(k) is not None else "") for k in DETAIL_KEYS}

def rows_equal(a: dict, b: dict) -> bool:
    return all(str(a.get(k, "")) == str(b.get(k, "")) for k in DETAIL_KEYS)

def fetch_detail(kapt_code: str) -> dict | None:
    for attempt in range(1, RETRIES + 1):
        try:
            r = requests.get(DETAIL_URL, params={
                "serviceKey": SERVICE_KEY, "kaptCode": kapt_code, "returnType": "json",
            }, timeout=10)
            if r.status_code != 200:
                time.sleep(1); continue
            data = r.json()
            rc   = data["response"]["header"]["resultCode"]
            if rc != "00": return None
            item = data["response"]["body"].get("item")
            return item if item else None
        except requests.exceptions.Timeout:
            time.sleep(2)
        except Exception:
            time.sleep(1)
    return None

# ══════════════════════════════════════════════════════════════════
#  워커 스레드
# ══════════════════════════════════════════════════════════════════
class CollectorWorker(QThread):
    s_log    = pyqtSignal(str, str)
    s_prog1  = pyqtSignal(int, int, str)
    s_prog2  = pyqtSignal(int, int)
    s_done   = pyqtSignal(str)

    def __init__(self, start_step: int = 1, end_step: int = 2):
        super().__init__()
        self._stop      = False
        self.start_step = start_step
        self.end_step   = end_step
        self.n_called = self.n_new = self.n_updated = self.n_skip = self.n_fail = 0
        self.n_upload = 0

    def stop(self): self._stop = True

    def run(self):
        try:
            for step in range(self.start_step, self.end_step + 1):
                if self._stop: break
                if   step == 1: self._step1()
                elif step == 2: self._step2()
            summary = (
                f"완료  │  API {self.n_called:,}회  │  신규 {self.n_new:,}건"
                f"  │  업데이트 {self.n_updated:,}건  │  skip {self.n_skip:,}건"
                f"  │  실패 {self.n_fail:,}건  │  R2 업로드 {self.n_upload:,}개"
            )
            self.s_done.emit(summary)
        except Exception as e:
            self.s_log.emit(f"❌ 치명적 오류: {e}", "warn")
            logger.critical(traceback.format_exc())
            self.s_done.emit("오류로 중단")

    # ── Step 1: API 수집 ─────────────────────────────────────────
    def _step1(self):
        self.s_log.emit("══ Step 1: 상세정보 API 수집 ══════════════════", "header")
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        src_files = list_input_files()
        if not src_files:
            self.s_log.emit(f"⚠ {INPUT_DIR} 에 *_list_coord.csv 파일이 없습니다.", "warn"); return

        all_codes = [(src, read_kapt_codes(src)) for src in src_files]
        total_all = sum(len(c) for _, c in all_codes)
        self.s_log.emit(f"📂 입력 {len(src_files)}개 파일 | 전체 {total_all:,}건", "ok")
        self.s_prog2.emit(0, total_all)

        processed = 0
        for fi, (src, codes) in enumerate(all_codes, 1):
            if self._stop: break
            dst      = output_path(src)
            existing = load_existing(dst)
            modified = False
            self.s_prog1.emit(fi, len(all_codes), src.name)
            self.s_log.emit(f"📄 {src.name}  (기존 {len(existing):,}건)", "info")

            for code in codes:
                if self._stop: break
                if self.n_called >= DAILY_LIMIT:
                    self.s_log.emit(f"⚠ 일일 한도 {DAILY_LIMIT:,}회 도달. 중단.", "warn")
                    self._stop = True; break

                time.sleep(SLEEP_SEC)
                item = fetch_detail(code)
                self.n_called += 1
                processed += 1
                self.s_prog2.emit(processed, total_all)

                if item is None:
                    self.n_fail += 1
                    self.s_log.emit(f"  ✗ {code} — API 응답 없음", "warn"); continue

                new_row = item_to_row(item)
                if code not in existing:
                    existing[code] = new_row; self.n_new += 1; modified = True
                elif not rows_equal(existing[code], new_row):
                    existing[code] = new_row; self.n_updated += 1; modified = True
                else:
                    self.n_skip += 1

                if processed % 500 == 0:
                    self.s_log.emit(
                        f"  … {processed:,}/{total_all:,} | 신규 {self.n_new:,} 업데이트 {self.n_updated:,} skip {self.n_skip:,}", "data")

            if modified:
                save_csv(dst, existing)
                self.s_log.emit(f"  ✅ {dst.name} 저장 완료 ({len(existing):,}건)", "ok")

    # ── Step 2: R2 업로드 ────────────────────────────────────────
    def _step2(self):
        self.s_log.emit("══ Step 2: Cloudflare R2 업로드 ══════════════════", "header")
        try:
            s3 = boto3.client("s3",
                endpoint_url=R2_ENDPOINT,
                aws_access_key_id=R2_ACCESS_KEY,
                aws_secret_access_key=R2_SECRET_KEY,
            )
            self.s_log.emit("  R2 파일 목록 확인 중...", "info")
            existing = {}
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=f"{R2_FOLDER}/"):
                for obj in page.get("Contents", []):
                    existing[obj["Key"]] = obj["LastModified"]
            self.s_log.emit(f"  R2 기존 파일: {len(existing):,}개", "info")

            files = [f for f in sorted(OUTPUT_DIR.glob("*")) if f.is_file() and f.suffix != ".py"]
            total_f = len(files)
            uploaded = skipped = 0

            for i, fp in enumerate(files, 1):
                if self._stop: break
                key = f"{R2_FOLDER}/{fp.name}"
                local_dt = datetime.fromtimestamp(fp.stat().st_mtime, tz=timezone.utc)
                if key in existing and local_dt <= existing[key]:
                    skipped += 1; continue
                self.s_prog1.emit(i, total_f, fp.name)
                s3.upload_file(str(fp), R2_BUCKET, key)

                uploaded += 1; self.n_upload += 1
                self.s_log.emit(f"  ↑ {fp.name}", "data")

            self.s_log.emit(f"  ✅ 업로드 완료  (신규/갱신: {uploaded}개 / 건너뜀: {skipped}개)", "ok")
        except Exception as e:
            self.s_log.emit(f"  ❌ R2 업로드 오류: {e}", "warn")
            logger.error(traceback.format_exc())


# ══════════════════════════════════════════════════════════════════
#  메인 윈도우 (1번 수집기와 동일한 다크 테마)
# ══════════════════════════════════════════════════════════════════
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("KAPT 상세정보 수집기  v2")
        self.resize(1120, 860)
        self.setStyleSheet("QMainWindow,QWidget{background:#131625;}")
        self.worker = None
        self._build_ui()
        self._log(f"✅ 준비 완료", "ok")
        self._log(f"   입력 폴더: {INPUT_DIR}", "info")
        self._log(f"   출력 폴더: {OUTPUT_DIR}", "info")
        self._log("   버튼을 눌러 수집을 시작하세요.", "info")

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        v = QVBoxLayout(root)
        v.setSpacing(8)
        v.setContentsMargins(12, 8, 12, 8)

        hdr = QLabel("KAPT  상세정보 수집기")
        hdr.setFont(QFont("맑은 고딕", 15, QFont.Weight.Bold))
        hdr.setStyleSheet("color:#6eb0f5; padding:2px 0;")
        v.addWidget(hdr)
        lbl_dir = QLabel(f"입력: {INPUT_DIR}   →   출력: {OUTPUT_DIR}")
        lbl_dir.setStyleSheet("color:#394a6a; font-size:9px;")
        v.addWidget(lbl_dir)

        mid = QHBoxLayout()
        mid.setSpacing(10)
        v.addLayout(mid)

        # ── 좌: API 게이지
        api_gb = self._groupbox("API  사용 현황")
        api_v  = QVBoxLayout(api_gb)
        api_v.setSpacing(8)
        self.g_api = _ApiGauge("상세정보 API  (getAphusDtlInfoV4)", DAILY_LIMIT)
        self.g_r2  = _ApiGauge("R2 업로드")
        api_v.addWidget(self.g_api)
        api_v.addWidget(self.g_r2)
        api_v.addStretch()
        mid.addWidget(api_gb, 4)

        # ── 우: 진행 현황 + 버튼
        prog_gb = self._groupbox("수집 진행 현황")
        prog_v  = QVBoxLayout(prog_gb)
        prog_v.setSpacing(6)

        self.lbl_phase = QLabel("대기 중")
        self.lbl_phase.setFont(QFont("맑은 고딕", 12, QFont.Weight.Bold))
        self.lbl_phase.setStyleSheet("color:#4c7cf3; background:#1a2040; border-radius:6px; padding:4px 10px;")
        prog_v.addWidget(self.lbl_phase)

        self.lbl_p1_name = QLabel("—")
        self.lbl_p1_name.setFont(QFont("맑은 고딕", 10, QFont.Weight.Bold))
        self.lbl_p1_name.setStyleSheet("color:#c8d4f0;")
        prog_v.addWidget(self.lbl_p1_name)
        self.bar1 = self._pbar("#4c7cf3", 18)
        prog_v.addWidget(self.bar1)
        self.lbl_p1_pct = QLabel("0 / 0")
        self.lbl_p1_pct.setStyleSheet("color:#3d4e6a; font-size:10px;")
        prog_v.addWidget(self.lbl_p1_pct)

        prog_v.addWidget(self._sep())

        self.lbl_p2_hd = QLabel("단지 처리: 대기 중")
        self.lbl_p2_hd.setStyleSheet("color:#4a5a78; font-size:10px;")
        prog_v.addWidget(self.lbl_p2_hd)
        self.bar2 = self._pbar("#f59f00", 12)
        prog_v.addWidget(self.bar2)
        self.lbl_p2_pct = QLabel("—")
        self.lbl_p2_pct.setStyleSheet("color:#3d4e6a; font-size:10px;")
        prog_v.addWidget(self.lbl_p2_pct)

        prog_v.addStretch()

        # 단계별 버튼
        step_row = QHBoxLayout()
        step_row.setSpacing(4)
        self.btn_collect = self._btn("수집", "#1864ab", "#1451a0")
        self.btn_r2      = self._btn("R2 업로드", "#862e9c", "#6d2580")
        for b in (self.btn_collect, self.btn_r2):
            b.setFixedHeight(32); step_row.addWidget(b)
        prog_v.addLayout(step_row)

        # 일괄 버튼
        bulk_row = QHBoxLayout()
        bulk_row.setSpacing(4)
        self.btn_all  = self._btn("▶  전체실행", "#0b7285", "#09636e")
        self.btn_stop = self._btn("■  중지", "#c92a2a", "#a61e1e")
        self.btn_stop.setEnabled(False)
        bulk_row.addWidget(self.btn_all)
        bulk_row.addWidget(self.btn_stop)
        prog_v.addLayout(bulk_row)

        self.btn_collect.clicked.connect(lambda: self._on_start(1, 1))
        self.btn_r2.clicked.connect(lambda: self._on_start(2, 2))
        self.btn_all.clicked.connect(lambda: self._on_start(1, 2))
        self.btn_stop.clicked.connect(self._on_stop)
        mid.addWidget(prog_gb, 5)

        log_gb = self._groupbox("실시간 로그")
        log_v  = QVBoxLayout(log_gb)
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        self.log.setFont(QFont("Consolas", 9))
        self.log.setStyleSheet("QTextEdit{background:#0c1020;color:#b0c0d8;border:none;border-radius:4px;padding:4px;}")
        log_v.addWidget(self.log)
        v.addWidget(log_gb, 1)

    def _groupbox(self, title):
        gb = QGroupBox(title)
        gb.setStyleSheet("""
            QGroupBox { color:#3d4e6a; font-size:10px; font-weight:bold;
                border:1px solid #1e2538; border-radius:8px;
                margin-top:8px; padding-top:10px; background:#161b2e; }
            QGroupBox::title { subcontrol-origin:margin; left:10px; padding:0 4px; }
        """)
        return gb

    def _pbar(self, color, h):
        b = QProgressBar(); b.setFixedHeight(h); r = h // 2
        b.setStyleSheet(
            f"QProgressBar{{background:#1e2538;border-radius:{r}px;text-align:center;color:#3d4e6a;font-size:9px;}}"
            f"QProgressBar::chunk{{background:{color};border-radius:{r}px;}}")
        return b

    def _sep(self):
        s = QFrame(); s.setFrameShape(QFrame.Shape.HLine)
        s.setStyleSheet("color:#1e2538;max-height:1px;"); return s

    def _btn(self, text, bg, hover):
        b = QPushButton(text)
        b.setFont(QFont("맑은 고딕", 10, QFont.Weight.Bold))
        b.setFixedHeight(38)
        b.setCursor(Qt.CursorShape.PointingHandCursor)
        b.setStyleSheet(
            f"QPushButton{{background:{bg};color:white;border-radius:6px;}}"
            f"QPushButton:hover{{background:{hover};}}"
            f"QPushButton:disabled{{background:#1e2538;color:#333;}}")
        return b

    def _set_btns_enabled(self, enabled):
        for b in (self.btn_collect, self.btn_r2, self.btn_all):
            b.setEnabled(enabled)
        self.btn_stop.setEnabled(not enabled)

    def _on_start(self, start_step, end_step):
        self._set_btns_enabled(False)
        labels = {1: "수집", 2: "R2업로드"}
        rng = " → ".join(labels[s] for s in range(start_step, end_step + 1))
        self._log(f"▶  {rng} 시작", "ok")
        self.lbl_phase.setText(rng)
        self.lbl_phase.setStyleSheet("color:#4c7cf3; background:#1a2040; border-radius:6px; padding:4px 10px; font-weight:bold; font-size:12px;")

        self.worker = CollectorWorker(start_step, end_step)
        self.worker.s_log.connect(self._log)
        self.worker.s_prog1.connect(self._on_prog1)
        self.worker.s_prog2.connect(self._on_prog2)
        self.worker.s_done.connect(self._on_done)
        self.worker.start()

    def _on_stop(self):
        if self.worker: self.worker.stop()
        self.btn_stop.setEnabled(False)
        self._log("⛔ 중지 요청  —  현재 작업 완료 후 중단됩니다.", "warn")

    def _on_prog1(self, cur, total, label):
        self.bar1.setMaximum(max(total, 1)); self.bar1.setValue(cur)
        self.lbl_p1_name.setText(label)
        pct = cur / total * 100 if total else 0
        self.lbl_p1_pct.setText(f"{cur} / {total}  ({pct:.1f}%)")

    def _on_prog2(self, cur, total):
        self.bar2.setMaximum(max(total, 1)); self.bar2.setValue(cur)
        pct = cur / total * 100 if total else 0
        self.lbl_p2_pct.setText(f"{cur} / {total}  ({pct:.1f}%)")

    def _on_done(self, summary):
        self._log(f"🎉  {summary}", "ok")
        logger.info(f"완료: {summary}")
        self.lbl_phase.setText("완료 ✅")
        self.lbl_phase.setStyleSheet("color:#69db7c; background:#1a2040; border-radius:6px; padding:4px 10px; font-weight:bold; font-size:12px;")
        self._set_btns_enabled(True)
        self.worker = None

    def _log(self, msg, level="info"):
        color   = LEVEL_COLOR.get(level, "#c0cfe8")
        stripped = msg.lstrip(" ")
        indent   = len(msg) - len(stripped)
        safe     = "&nbsp;" * indent + html.escape(stripped)
        self.log.moveCursor(QTextCursor.MoveOperation.End)
        self.log.insertHtml(f'<span style="color:{color};">{safe}</span><br>')
        self.log.moveCursor(QTextCursor.MoveOperation.End)
        logger.debug(msg.strip())

    def closeEvent(self, event):
        if self.worker and self.worker.isRunning():
            self.worker.stop()
        event.accept()


# ══════════════════════════════════════════════════════════════════
#  API 게이지 위젯 (1번과 동일)
# ══════════════════════════════════════════════════════════════════
class _ApiGauge(QFrame):
    def __init__(self, title, limit=0):
        super().__init__()
        self.limit = limit
        self.setFrameShape(QFrame.Shape.StyledPanel)
        self.setStyleSheet("QFrame{background:#1a1f33;border-radius:8px;}")
        lay = QVBoxLayout(self); lay.setSpacing(4); lay.setContentsMargins(12, 8, 12, 8)
        lbl = QLabel(title)
        lbl.setFont(QFont("맑은 고딕", 9, QFont.Weight.Bold))
        lbl.setStyleSheet("color:#697ea8;"); lay.addWidget(lbl)
        if limit:
            self.bar = QProgressBar(); self.bar.setMaximum(limit); self.bar.setValue(0)
            self.bar.setTextVisible(False); self.bar.setFixedHeight(8)
            self._set_bar("#4c7cf3"); lay.addWidget(self.bar)
        self.lbl_n = QLabel(f"0 / {limit:,}" if limit else "0 회")
        self.lbl_n.setFont(QFont("Consolas", 13, QFont.Weight.Bold))
        self.lbl_n.setStyleSheet("color:#dde5ff;"); lay.addWidget(self.lbl_n)

    def _set_bar(self, color):
        self.bar.setStyleSheet(
            "QProgressBar{background:#252b44;border-radius:4px;}"
            f"QProgressBar::chunk{{background:{color};border-radius:4px;}}")

    def set_value(self, n):
        if self.limit:
            self.bar.setValue(min(n, self.limit))
            pct = n / self.limit
            self._set_bar("#e03131" if pct >= 1.0 else "#f76707" if pct >= 0.8 else "#4c7cf3")
            self.lbl_n.setText(f"{n:,} / {self.limit:,}")
        else:
            self.lbl_n.setText(f"{n:,} 회")


# ══════════════════════════════════════════════════════════════════
#  진입점
# ══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    win = MainWindow()
    win.show()
    sys.exit(app.exec())
