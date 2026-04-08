"""
KAPT 상세정보 수집기
══════════════════════════════════════════════════════════════════
단계:
  KaptList\*_list_coord.csv 의 kaptCode
    → getAphusDtlInfoV4 API 호출
    → KaptDetail\*_Details.csv 저장

재실행 동작:
  - API 응답이 기존 데이터와 완전히 동일  → skip (파일 쓰기 없음)
  - API 응답에 변경된 셀이 하나라도 있음  → 해당 행 업데이트
  - 기존 파일에 없던 kaptCode           → 파일 맨 아래에 추가
  - 파일 내 변경/추가가 없으면 파일 재저장하지 않음

일일 한도:
  1,000,000 회 도달 시 자동 중단
"""

import csv
import logging
import pathlib
import sys
import time
from collections import OrderedDict

import requests
from PyQt5.QtCore import QThread, pyqtSignal
from PyQt5.QtGui import QFont, QTextCursor
from PyQt5.QtWidgets import (
    QApplication, QGroupBox, QHBoxLayout, QLabel,
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
SLEEP_SEC   = 0.12   # API 호출 간격 (초)
RETRIES     = 3

# API 반환 필드 고정 순서
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

# ── 로거
logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s",
                    datefmt="%H:%M:%S")
logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════
#  헬퍼
# ══════════════════════════════════════════════════════════════════
def list_input_files() -> list[pathlib.Path]:
    """KaptList 폴더에서 *_list_coord.csv 파일 목록 반환 (정렬)"""
    return sorted(INPUT_DIR.glob("*_list_coord.csv"))


def output_path(src: pathlib.Path) -> pathlib.Path:
    """강원_강릉_51150_list_coord.csv → KaptDetail/강원_강릉_51150_Details.csv"""
    return OUTPUT_DIR / src.name.replace("_list_coord.csv", "_Details.csv")


def read_kapt_codes(src: pathlib.Path) -> list[str]:
    """CSV 에서 kaptCode 컬럼 값 목록 반환 (순서 유지, 중복 제거)"""
    codes: list[str] = []
    seen: set[str]   = set()
    for enc in ("utf-8-sig", "cp949", "utf-8"):
        try:
            with open(src, encoding=enc, newline="") as fp:
                for row in csv.DictReader(fp):
                    code = (row.get("kaptCode") or "").strip()
                    if code and code not in seen:
                        codes.append(code)
                        seen.add(code)
            return codes
        except (UnicodeDecodeError, KeyError):
            continue
    logger.warning(f"[인코딩 실패] {src.name}")
    return []


def load_existing(dst: pathlib.Path) -> OrderedDict[str, dict]:
    """
    기존 Detail CSV 를 OrderedDict 로 로드.
    key = kaptCode, value = {col: val, ...}
    파일이 없으면 빈 OrderedDict 반환.
    """
    result: OrderedDict[str, dict] = OrderedDict()
    if not dst.exists():
        return result
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
    logger.warning(f"[인코딩 실패 — 기존파일 무시] {dst.name}")
    return result


def save_csv(dst: pathlib.Path, data: OrderedDict[str, dict]) -> None:
    """OrderedDict 전체를 CSV 로 저장 (덮어쓰기)"""
    with open(dst, "w", encoding="utf-8-sig", newline="") as fp:
        writer = csv.DictWriter(fp, fieldnames=DETAIL_KEYS, extrasaction="ignore")
        writer.writeheader()
        for row in data.values():
            writer.writerow(row)


def item_to_row(item: dict) -> dict:
    """API 응답 item → DETAIL_KEYS 기준 정규화된 dict"""
    return {k: str(item.get(k) if item.get(k) is not None else "") for k in DETAIL_KEYS}


def rows_equal(a: dict, b: dict) -> bool:
    """두 행이 DETAIL_KEYS 기준으로 완전히 동일한지 비교"""
    return all(str(a.get(k, "")) == str(b.get(k, "")) for k in DETAIL_KEYS)


def fetch_detail(kapt_code: str) -> dict | None:
    """Detail API V4 호출 → item dict (실패 시 None)"""
    for attempt in range(1, RETRIES + 1):
        try:
            r = requests.get(DETAIL_URL, params={
                "serviceKey": SERVICE_KEY,
                "kaptCode":   kapt_code,
                "returnType": "json",
            }, timeout=10)
            if r.status_code != 200:
                logger.warning(f"  HTTP {r.status_code} — {kapt_code} (시도 {attempt})")
                time.sleep(1)
                continue
            data = r.json()
            rc   = data["response"]["header"]["resultCode"]
            if rc != "00":
                msg = data["response"]["header"].get("resultMsg", "")
                logger.warning(f"  API 오류 {rc} {msg} — {kapt_code}")
                return None
            item = data["response"]["body"].get("item")
            if not item:
                return None
            return item
        except requests.exceptions.Timeout:
            logger.warning(f"  타임아웃 — {kapt_code} (시도 {attempt})")
            time.sleep(2)
        except Exception as e:
            logger.warning(f"  예외 {e} — {kapt_code} (시도 {attempt})")
            time.sleep(1)
    return None


# ══════════════════════════════════════════════════════════════════
#  Worker Thread
# ══════════════════════════════════════════════════════════════════
class CollectorThread(QThread):
    s_log      = pyqtSignal(str, str)   # (message, level)
    s_progress = pyqtSignal(int, int)   # (current, total)
    s_file     = pyqtSignal(str)        # current file label
    s_done     = pyqtSignal(str)        # summary message

    def __init__(self):
        super().__init__()
        self._stop     = False
        self.n_called  = 0   # API 호출 수
        self.n_new     = 0   # 신규 추가 수
        self.n_updated = 0   # 업데이트 수
        self.n_skip    = 0   # 동일(변경없음) 스킵 수
        self.n_fail    = 0   # API 응답 없음 수

    def stop(self):
        self._stop = True

    def run(self):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        src_files = list_input_files()
        if not src_files:
            self.s_log.emit(f"⚠ {INPUT_DIR} 에 *_list_coord.csv 파일이 없습니다.", "warn")
            self.s_done.emit("파일 없음")
            return

        # 전체 처리 대상 수 (진행바용)
        all_codes_per_file: list[tuple[pathlib.Path, list[str]]] = [
            (src, read_kapt_codes(src)) for src in src_files
        ]
        total_all = sum(len(codes) for _, codes in all_codes_per_file)

        self.s_log.emit(
            f"📂 입력 파일 {len(src_files)}개 | 전체 kaptCode {total_all:,}건 "
            f"| API 호출 후 동일하면 skip / 변경·신규는 저장", "ok"
        )
        self.s_progress.emit(0, total_all)

        processed = 0  # 진행바 카운터 (API 호출 시도 횟수)

        for src, codes in all_codes_per_file:
            if self._stop:
                break

            dst = output_path(src)
            existing: OrderedDict[str, dict] = load_existing(dst)
            file_modified = False

            self.s_file.emit(src.name)
            self.s_log.emit(f"📄 {src.name}  (기존 {len(existing):,}건)", "info")

            for code in codes:
                if self._stop:
                    break
                if self.n_called >= DAILY_LIMIT:
                    self.s_log.emit(
                        f"⚠ 일일 API 한도 {DAILY_LIMIT:,}회 도달. 중단합니다.", "warn")
                    self._stop = True
                    break

                time.sleep(SLEEP_SEC)
                item = fetch_detail(code)
                self.n_called += 1
                processed += 1

                if item is None:
                    self.n_fail += 1
                    self.s_log.emit(f"  ✗ {code} — API 응답 없음", "warn")
                    self.s_progress.emit(processed, total_all)
                    continue

                new_row = item_to_row(item)

                if code not in existing:
                    # ── 신규: 맨 아래 추가
                    existing[code] = new_row
                    self.n_new += 1
                    file_modified = True
                elif not rows_equal(existing[code], new_row):
                    # ── 변경: 기존 행 업데이트 (순서 유지)
                    existing[code] = new_row
                    self.n_updated += 1
                    file_modified = True
                else:
                    # ── 동일: skip
                    self.n_skip += 1

                self.s_progress.emit(processed, total_all)

                # 500건마다 중간 로그
                if processed % 500 == 0:
                    self.s_log.emit(
                        f"  … {processed:,} / {total_all:,} | "
                        f"신규 {self.n_new:,}  업데이트 {self.n_updated:,}  "
                        f"동일skip {self.n_skip:,}  실패 {self.n_fail:,}", "ok"
                    )

            # 파일이 변경된 경우에만 재저장
            if file_modified:
                save_csv(dst, existing)
                self.s_log.emit(
                    f"  💾 저장 완료 — {dst.name}  ({len(existing):,}건)", "ok")

        summary = (
            f"수집 종료 │ API {self.n_called:,}회 │ "
            f"신규 {self.n_new:,}건 │ "
            f"업데이트 {self.n_updated:,}건 │ "
            f"동일skip {self.n_skip:,}건 │ "
            f"실패 {self.n_fail:,}건"
        )
        self.s_done.emit(summary)


# ══════════════════════════════════════════════════════════════════
#  GUI
# ══════════════════════════════════════════════════════════════════
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("KAPT 상세정보 수집기  (getAphusDtlInfoV4)")
        self.resize(820, 600)
        self._thread: CollectorThread | None = None
        self._build_ui()

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        v = QVBoxLayout(root)
        v.setSpacing(10)
        v.setContentsMargins(14, 14, 14, 14)

        # ── 경로 표시
        path_box = QGroupBox("경로")
        pv = QVBoxLayout(path_box)
        pv.addWidget(QLabel(f"입력:  {INPUT_DIR}"))
        pv.addWidget(QLabel(f"출력:  {OUTPUT_DIR}"))
        v.addWidget(path_box)

        # ── 현재 파일 표시
        self.lbl_file = QLabel("대기 중…")
        self.lbl_file.setStyleSheet("color:#394a6a; font-size:10px;")
        v.addWidget(self.lbl_file)

        # ── 진행바
        self.bar = QProgressBar()
        self.bar.setTextVisible(True)
        self.bar.setFormat("%v / %m  (%p%)")
        v.addWidget(self.bar)

        # ── 카운터 행
        hc = QHBoxLayout()
        self.lbl_count = QLabel("API: 0  |  신규: 0  |  업데이트: 0  |  동일skip: 0  |  실패: 0")
        self.lbl_count.setStyleSheet("font-weight:bold; color:#1f2b49;")
        hc.addWidget(self.lbl_count)
        hc.addStretch()
        self.lbl_limit = QLabel(f"일일 한도: {DAILY_LIMIT:,}")
        self.lbl_limit.setStyleSheet("color:#888;")
        hc.addWidget(self.lbl_limit)
        v.addLayout(hc)

        # ── 로그 패널
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        self.log.setFont(QFont("Consolas", 9))
        self.log.setStyleSheet(
            "background:#101828; color:#c8d8f0; border-radius:6px; padding:6px;")
        v.addWidget(self.log, stretch=1)

        # ── 버튼
        hb = QHBoxLayout()
        self.btn_start = QPushButton("▶  수집 시작")
        self.btn_start.setFixedHeight(38)
        self.btn_start.setStyleSheet(
            "background:#4c6ef5; color:white; font-weight:bold; border-radius:8px;")
        self.btn_start.clicked.connect(self._start)
        self.btn_stop = QPushButton("■  중지")
        self.btn_stop.setFixedHeight(38)
        self.btn_stop.setEnabled(False)
        self.btn_stop.setStyleSheet(
            "background:#e03131; color:white; font-weight:bold; border-radius:8px;")
        self.btn_stop.clicked.connect(self._stop)
        hb.addWidget(self.btn_start)
        hb.addWidget(self.btn_stop)
        v.addLayout(hb)

    def _update_counter(self):
        t = self._thread
        if not t:
            return
        self.lbl_count.setText(
            f"API: {t.n_called:,}  |  신규: {t.n_new:,}  |  "
            f"업데이트: {t.n_updated:,}  |  동일skip: {t.n_skip:,}  |  실패: {t.n_fail:,}"
        )

    def _start(self):
        self.log.clear()
        self.bar.setValue(0)
        self.bar.setMaximum(1)
        self._log("수집 시작…", "ok")

        self._thread = CollectorThread()
        self._thread.s_log.connect(self._log)
        self._thread.s_progress.connect(self._on_progress)
        self._thread.s_file.connect(lambda f: self.lbl_file.setText(f"처리 중: {f}"))
        self._thread.s_done.connect(self._on_done)

        self.btn_start.setEnabled(False)
        self.btn_stop.setEnabled(True)
        self._thread.start()

    def _stop(self):
        if self._thread:
            self._thread.stop()
            self._log("중지 요청됨…", "warn")
        self.btn_stop.setEnabled(False)

    def _on_progress(self, cur: int, total: int):
        self.bar.setMaximum(max(total, 1))
        self.bar.setValue(cur)
        self._update_counter()

    def _on_done(self, summary: str):
        self._log(f"🏁 {summary}", "ok")
        self.lbl_file.setText("완료")
        self.btn_start.setEnabled(True)
        self.btn_stop.setEnabled(False)
        self._update_counter()

    def _log(self, msg: str, level: str = "info"):
        COLOR = {"ok": "#74c0fc", "warn": "#ffa94d", "info": "#c8d8f0"}
        color = COLOR.get(level, "#c8d8f0")
        ts = time.strftime("%H:%M:%S")
        html = (f'<span style="color:#6a7692">[{ts}]</span> '
                f'<span style="color:{color}">{msg}</span>')
        self.log.append(html)
        self.log.moveCursor(QTextCursor.End)


# ══════════════════════════════════════════════════════════════════
#  엔트리포인트
# ══════════════════════════════════════════════════════════════════
def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    win = MainWindow()
    win.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
