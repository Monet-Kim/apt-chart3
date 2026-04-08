# -*- coding: utf-8 -*-
"""
MP 부동산 데이터 수집기
- 실거래(R) + 분양권(P) 통합 수집
- PyQt6 기반 세련된 UI
- 전체 진행률 + ETA + API 한도 게이지
- 버그 수정 완료
"""

import os, re, glob, json, time, ssl, sys
import requests
from requests.adapters import HTTPAdapter
import xml.etree.ElementTree as ET
import pandas as pd
from datetime import datetime, timedelta
from pathlib import Path

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QTextEdit, QProgressBar, QFrame,
    QSplitter, QTabWidget, QScrollArea, QGridLayout, QSpacerItem,
    QSizePolicy
)
from PyQt6.QtCore import (
    Qt, QThread, pyqtSignal, QTimer, QElapsedTimer, QMutex, QMutexLocker
)
from PyQt6.QtGui import QFont, QColor, QPalette, QTextCursor, QIcon

# ─────────────────────────────────────────────
# 설정
# ─────────────────────────────────────────────
SERVICE_KEY = "HcVtWuaWvdDSFSZQtcDh5WXItVvZ9Wof23DGfIzh0fUEGb9v06BprdP6QIPK2rVTVsHKx9i3WgsXWYXOZE4vbg=="
R_BASE_URL  = "http://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
P_BASE_URL  = "https://apis.data.go.kr/1613000/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade"
API_LIMIT   = 1_000_000

BASE_DIR      = Path(os.path.abspath(__file__)).parent  # = public/
KAPT_LIST_DIR = BASE_DIR / "KaptList"
RDATA_DIR     = BASE_DIR / "Rdata"
PDATA_DIR     = BASE_DIR / "Pdata"

# ─────────────────────────────────────────────
# TLS 세션 (분양권 P용)
# ─────────────────────────────────────────────
class TLS12HttpAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.create_default_context()
        ctx.minimum_version = ssl.TLSVersion.TLSv1_2
        ctx.maximum_version = ssl.TLSVersion.TLSv1_2
        try:
            ctx.set_ciphers("DEFAULT:@SECLEVEL=1")
        except Exception:
            pass
        kwargs["ssl_context"] = ctx
        return super().init_poolmanager(*args, **kwargs)

def make_session():
    s = requests.Session()
    s.trust_env = False
    s.mount("https://", TLS12HttpAdapter())
    s.mount("http://",  TLS12HttpAdapter())
    s.headers.update({"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    return s

HTTP_SESSION = make_session()

# ─────────────────────────────────────────────
# 공통 유틸 함수
# ─────────────────────────────────────────────
def list_csv_files():
    """public/KaptList/ 의 *_list_coord.csv 파일에서 시도/시군구/법정동코드 추출"""
    pat1 = re.compile(r"(.+?)_(.+?)_(\d{5})_list_coord\.csv")
    pat2 = re.compile(r"(.+?)_(\d{5})_list_coord\.csv")
    result = []
    if not KAPT_LIST_DIR.exists():
        return result
    for fname in os.listdir(str(KAPT_LIST_DIR)):
        if not fname.endswith(".csv"):
            continue
        m1 = pat1.match(fname)
        if m1:
            sido, sigungu, lawd_cd = m1.groups()
            result.append((str(KAPT_LIST_DIR / fname), lawd_cd, sido, sigungu))
            continue
        m2 = pat2.match(fname)
        if m2:
            sido, lawd_cd = m2.groups()
            result.append((str(KAPT_LIST_DIR / fname), lawd_cd, sido, ""))
    return result


def get_latest_ym(base_prefix: str):
    """연도별 CSV에서 가장 최신 연월(YYYYMM int) 추출"""
    files = glob.glob(base_prefix + "_[0-9][0-9][0-9][0-9].csv")
    latest = None
    for fp in files:
        try:
            df = pd.read_csv(fp, dtype=str)
            if df.empty:
                continue
            y = pd.to_numeric(df.get("dealYear"),  errors="coerce")
            m = pd.to_numeric(df.get("dealMonth"), errors="coerce")
            ym = (y * 100 + m).dropna().astype(int)
            if ym.empty:
                continue
            mx = int(ym.max())
            latest = mx if (latest is None or mx > latest) else latest
        except Exception:
            continue
    return latest


def newest_mtime(base_prefix: str):
    """해당 prefix의 CSV + index.json 중 가장 최신 수정시간 반환"""
    files = glob.glob(base_prefix + "_[0-9][0-9][0-9][0-9].csv")
    idx = base_prefix + "_index.json"
    if os.path.exists(idx):
        files.append(idx)
    if not files:
        return None
    return max(os.path.getmtime(p) for p in files)


def update_year_csvs(base_prefix: str, df_new: pd.DataFrame):
    """연도별 CSV 저장 + index.json 생성 (버그 수정: 이중 open 제거)"""
    df_new = df_new.copy()
    for col in ("dealYear", "dealMonth", "dealDay"):
        df_new[col] = pd.to_numeric(df_new.get(col), errors="coerce").fillna(0).astype(int)
    df_new["ym"] = df_new["dealYear"] * 100 + df_new["dealMonth"]

    years = sorted(df_new["dealYear"].unique())
    written_years = []

    for year in years:
        if year <= 0:
            continue
        out_csv = f"{base_prefix}_{year}.csv"
        new_y = df_new[df_new["dealYear"] == year].copy()
        target_ym = set(new_y["ym"].unique())

        if os.path.exists(out_csv):
            try:
                old = pd.read_csv(out_csv, dtype=str)
            except Exception:
                old = pd.DataFrame()
            if not old.empty:
                for col in ("dealYear", "dealMonth", "dealDay"):
                    old[col] = pd.to_numeric(old.get(col), errors="coerce").fillna(0).astype(int)
                old["ym"] = old["dealYear"] * 100 + old["dealMonth"]
                old = old[~old["ym"].isin(target_ym)]
            merged = pd.concat([old, new_y], ignore_index=True) if not old.empty else new_y
        else:
            merged = new_y

        merged.drop(columns=["ym"], errors="ignore", inplace=True)
        merged.sort_values(by=["dealYear", "dealMonth", "dealDay"], ascending=False, inplace=True)
        merged.to_csv(out_csv, index=False, encoding="utf-8-sig")
        written_years.append(int(year))

    # ── index.json (버그 수정: 이중 with open 제거) ──
    existing_years = []
    for fp in glob.glob(base_prefix + "_[0-9][0-9][0-9][0-9].csv"):
        m = re.search(r"_(\d{4})\.csv$", fp)
        if m:
            existing_years.append(int(m.group(1)))
    all_years   = sorted(set(existing_years) | set(written_years))
    latest_ym   = int((df_new["dealYear"] * 100 + df_new["dealMonth"]).max()) if not df_new.empty else None

    idx_path = f"{base_prefix}_index.json"
    with open(idx_path, "w", encoding="utf-8") as f:          # ← 단 한 번만 open
        json.dump({"years": all_years, "latest_ym": latest_ym}, f, ensure_ascii=False)


def generate_months(start_ym: int):
    end_ym = int(datetime.now().strftime("%Y%m"))
    months, ym = [], start_ym
    while ym <= end_ym:
        months.append(str(ym))
        y, m = ym // 100, ym % 100 + 1
        if m > 12:
            y, m = y + 1, 1
        ym = y * 100 + m
    return months

# ─────────────────────────────────────────────
# 실거래(R) API 호출
# ─────────────────────────────────────────────
def fetch_r_data(lawd_cd, months, stop_flag, log_cb, api_cb):
    """실거래 데이터 수집 (버그 수정: timeout 추가, 에러 체크 추가)"""
    all_data, total_req = [], 0
    for i, deal_ym in enumerate(months):
        if stop_flag():
            return None, total_req
        page = 1
        while True:
            if stop_flag():
                return None, total_req
            params = {
                "serviceKey": SERVICE_KEY,
                "LAWD_CD": lawd_cd,
                "DEAL_YMD": deal_ym,
                "numOfRows": 500,
                "pageNo": page,
            }
            try:
                resp = requests.get(R_BASE_URL, params=params, timeout=(5, 20))
                total_req += 1
                api_cb(total_req)
            except requests.exceptions.RequestException as e:
                log_cb(f"  ⚠ 네트워크 오류 {deal_ym}: {e}", "warn")
                break

            try:
                root = ET.fromstring(resp.content)
            except ET.ParseError:
                log_cb(f"  ⚠ XML 파싱 오류 {deal_ym}", "warn")
                break

            # ── 에러 코드 체크 (버그 수정) ──
            code = (root.findtext(".//resultCode") or "").strip()
            msg  = (root.findtext(".//resultMsg")  or "").strip()
            no_data = (code == "03") or ("NO DATA" in msg.upper() or "NODATA" in msg.upper())
            if no_data:
                log_cb(f"  · {deal_ym} 데이터 없음", "skip")
                break

            items = root.findall(".//item")
            log_cb(f"  · {deal_ym} p{page} → {len(items)}건", "info")

            for item in items:
                row = {k: item.findtext(k, "") for k in (
                    "sggCd","umdCd","landCd","bonbun","bubun",
                    "roadNm","roadNmSggCd","roadNmCd","roadNmSeq",
                    "roadNmbCd","roadNmBonbun","roadNmBubun",
                    "umdNm","aptNm","jibun","excluUseAr",
                    "dealYear","dealMonth","dealDay","dealAmount",
                    "floor","buildYear","aptSeq","cdealType","cdealDay",
                    "dealingGbn","estateAgentSggNm","rgstDate","aptDong",
                    "slerGbn","buyerGbn","landLeaseholdGbn",
                )}
                row["resultMsg"]  = msg
                row["numOfRows"]  = root.findtext(".//numOfRows", "")
                row["pageNo"]     = page
                row["totalCount"] = root.findtext(".//totalCount", "")
                row["pnu"] = (
                    row["sggCd"].zfill(5) + row["umdCd"].zfill(5) +
                    row["landCd"].zfill(1) + row["bonbun"].zfill(4) + row["bubun"].zfill(4)
                )
                all_data.append(row)

            if len(items) < 500:
                break
            page += 1
            time.sleep(0.13)

    return all_data, total_req

# ─────────────────────────────────────────────
# 분양권(P) API 호출
# ─────────────────────────────────────────────
def fetch_p_data(lawd_cd, months, stop_flag, log_cb, api_cb):
    all_data, total_req = [], 0
    for i, deal_ym in enumerate(months):
        if stop_flag():
            return None, total_req
        page = 1
        while True:
            if stop_flag():
                return None, total_req
            params = {
                "serviceKey": SERVICE_KEY,
                "LAWD_CD": lawd_cd,
                "DEAL_YMD": deal_ym,
                "numOfRows": 500,
                "pageNo": page,
            }
            try:
                resp = HTTP_SESSION.get(P_BASE_URL, params=params, timeout=(5, 20))
                total_req += 1
                api_cb(total_req)
            except requests.exceptions.SSLError:
                try:
                    fb = P_BASE_URL.replace("https://", "http://")
                    resp = HTTP_SESSION.get(fb, params=params, timeout=(5, 20))
                    total_req += 1
                    api_cb(total_req)
                except Exception as e:
                    log_cb(f"  ⚠ SSL 폴백 실패 {deal_ym}: {e}", "warn")
                    break
            except requests.exceptions.RequestException as e:
                log_cb(f"  ⚠ 네트워크 오류 {deal_ym}: {e}", "warn")
                break

            try:
                root = ET.fromstring(resp.content)
            except ET.ParseError:
                log_cb(f"  ⚠ XML 파싱 오류 {deal_ym}", "warn")
                break

            code = (root.findtext(".//resultCode") or "").strip()
            msg  = (root.findtext(".//resultMsg")  or "").strip()
            is_ok   = code in {"00","000"} or msg.upper() in {"OK","NORMAL SERVICE.","NORMAL SERVICE"}
            no_data = code == "03" or "NO DATA" in msg.upper() or "NODATA" in msg.upper()

            if no_data:
                log_cb(f"  · {deal_ym} 데이터 없음", "skip")
                break
            if not is_ok and not no_data:
                log_cb(f"  ⚠ API 오류 {code}: {msg}", "warn")
                break

            items = root.findall(".//item")
            log_cb(f"  · {deal_ym} p{page} → {len(items)}건", "info")

            for item in items:
                get = lambda k: item.findtext(k, "")
                aptNm      = get("aptNm")
                excluUseAr = get("excluUseAr")
                dealYear   = get("dealYear")
                dealMonth  = get("dealMonth")
                dealDay    = get("dealDay")
                dealAmount = get("dealAmount")
                floor      = get("floor")
                cdealType  = get("cdealType")
                cdealDay   = get("cdealDay")

                y = str(dealYear).strip()
                m_str = str(dealMonth).zfill(2)
                d_str = str(dealDay).zfill(2)
                dealDate = f"{y}-{m_str}-{d_str}" if y and y.isdigit() else ""

                amt_clean = dealAmount.replace(",","").strip()
                dealAmount_mw = int(amt_clean) if amt_clean.isdigit() else None
                isCanceled = 1 if str(cdealType).strip() != "" else 0
                cancelDate = f"{y}-{m_str}-{str(cdealDay).zfill(2)}" if isCanceled and cdealDay else ""

                all_data.append({
                    "aptNm": aptNm, "excluUseAr": excluUseAr,
                    "dealAmount": dealAmount, "dealAmount_mw": dealAmount_mw,
                    "dealYear": dealYear, "dealMonth": dealMonth, "dealDay": dealDay,
                    "dealDate": dealDate, "floor": floor,
                    "buyerGbn": get("buyerGbn"), "dealingGbn": get("dealingGbn"),
                    "estateAgentSggNm": get("estateAgentSggNm"), "jibun": get("jibun"),
                    "ownershipGbn": get("ownershipGbn"), "sggCd": get("sggCd"),
                    "sggNm": get("sggNm"), "slerGbn": get("slerGbn"), "umdNm": get("umdNm"),
                    "cdealType": cdealType, "cdealDay": cdealDay,
                    "cancelDate": cancelDate, "isCanceled": isCanceled,
                    "status": "취소" if isCanceled else "정상",
                    "resultMsg": msg, "numOfRows": root.findtext(".//numOfRows",""),
                    "pageNo": page, "totalCount": root.findtext(".//totalCount",""),
                })

            if len(items) < 500:
                break
            page += 1
            time.sleep(0.13)

    return all_data, total_req

# ─────────────────────────────────────────────
# 작업 스레드
# ─────────────────────────────────────────────
class WorkerThread(QThread):
    sig_log         = pyqtSignal(str, str)        # (message, level)
    sig_progress    = pyqtSignal(int, int, int, int)  # (file_idx, total, month_pct, type 0=R/1=P)
    sig_api         = pyqtSignal(int)             # 누적 API 요청 수
    sig_item_done   = pyqtSignal(str, bool)       # (label, success)
    sig_finished    = pyqtSignal(str)             # 완료 메시지
    sig_eta         = pyqtSignal(int)             # 남은 초

    def __init__(self, mode: str, skip_hours: int, start_ym_override: int = None):
        super().__init__()
        self.mode = mode          # "R" | "P" | "RP"
        self.skip_hours = skip_hours
        self.start_ym_override = start_ym_override
        self._stop = False
        self._global_req = 0
        self._mutex = QMutex()
        self._elapsed = QElapsedTimer()

    def stop(self):
        self._stop = True

    def _stopped(self):
        return self._stop

    def _on_api(self, delta: int):
        with QMutexLocker(self._mutex):
            self._global_req += delta
        self.sig_api.emit(self._global_req)

    def _collect(self, mode_char: str, csv_files, type_idx: int):
        out_dir    = RDATA_DIR if mode_char == "R" else PDATA_DIR
        prefix_key = "Rdata"  if mode_char == "R" else "Pdata"
        skip_h     = self.skip_hours
        start_base = 200601 if mode_char == "R" else 202001
        total = len(csv_files)
        out_dir.mkdir(parents=True, exist_ok=True)
        self._elapsed.start()

        for idx, (_, lawd_cd, sido, sigungu) in enumerate(csv_files, 1):
            if self._stop:
                break

            label = f"{'R' if mode_char=='R' else 'P'} | {sido} {sigungu} {lawd_cd}"
            self.sig_log.emit(f"\n▶ [{idx}/{total}] {label}", "header")
            self.sig_progress.emit(idx, total, 0, type_idx)

            # ── 파일 prefix ──
            base_prefix = str(
                out_dir / (f"{prefix_key}_{sido}_{sigungu}_{lawd_cd}" if sigungu
                           else f"{prefix_key}_{sido}_{lawd_cd}")
            )

            # ── skip 체크 ──
            mt = newest_mtime(base_prefix)
            if mt is not None:
                elapsed_h = (time.time() - mt) / 3600
                if elapsed_h < skip_h:
                    self.sig_log.emit(f"  ⏭ {skip_h}시간 이내 수정됨, skip", "skip")
                    self.sig_item_done.emit(label, True)
                    self.sig_progress.emit(idx, total, 100, type_idx)
                    continue

            # ── 시작 연월 결정 ──
            if self.start_ym_override:
                start_ym = self.start_ym_override
            else:
                latest = get_latest_ym(base_prefix)
                if latest is None:
                    start_ym = start_base
                else:
                    y, m = divmod(latest, 100)
                    m -= 2
                    if m <= 0:
                        y, m = y - 1, m + 12
                    start_ym = y * 100 + m

            months = generate_months(start_ym)
            self.sig_log.emit(f"  📅 수집 기간: {start_ym} ~ 현재 ({len(months)}개월)", "info")

            # ── API 호출 ──
            prev_req = self._global_req
            fetch_fn = fetch_r_data if mode_char == "R" else fetch_p_data

            def api_cb(delta_local, _prev=prev_req):
                with QMutexLocker(self._mutex):
                    self._global_req = _prev + delta_local
                self.sig_api.emit(self._global_req)

            raw, req_count = fetch_fn(
                lawd_cd, months,
                self._stopped,
                lambda msg, lv: self.sig_log.emit(msg, lv),
                api_cb,
            )

            with QMutexLocker(self._mutex):
                self._global_req = prev_req + req_count
            self.sig_api.emit(self._global_req)

            # ── ETA 계산 ──
            elapsed_sec = self._elapsed.elapsed() / 1000
            if idx > 0 and elapsed_sec > 0:
                rate = elapsed_sec / idx
                eta  = int(rate * (total - idx))
                self.sig_eta.emit(eta)

            # ── 저장 ──
            if raw is None or len(raw) == 0:
                self.sig_log.emit(f"  ℹ 거래 데이터 없음", "skip")
                self.sig_item_done.emit(label, True)
            else:
                df = pd.DataFrame(raw)
                update_year_csvs(base_prefix, df)
                self.sig_log.emit(
                    f"  ✅ 저장 완료  (이번: {req_count}회 / 누적: {self._global_req}회)", "ok"
                )
                self.sig_item_done.emit(label, True)

            self.sig_progress.emit(idx, total, 100, type_idx)

            # ── API 한도 체크 ──
            if self._global_req >= API_LIMIT:
                self.sig_log.emit(
                    f"\n⛔ 누적 요청 {self._global_req}회 → API 일일 한도({API_LIMIT}회) 도달. 중단합니다.", "error"
                )
                self._stop = True
                break

            time.sleep(0.1)

    def run(self):
        csv_files = list_csv_files()
        if not csv_files:
            self.sig_log.emit(f"⚠ KaptList 폴더에 *_list_coord.csv 파일이 없습니다.\n   경로: {KAPT_LIST_DIR}", "warn")
            self.sig_finished.emit("파일 없음")
            return

        if self.mode in ("R", "RP"):
            self.sig_log.emit("═" * 50, "header")
            self.sig_log.emit("  🏠 실거래(R) 데이터 수집 시작", "header")
            self.sig_log.emit("═" * 50, "header")
            self._collect("R", csv_files, 0)

        if not self._stop and self.mode in ("P", "RP"):
            self.sig_log.emit("═" * 50, "header")
            self.sig_log.emit("  📋 분양권(P) 데이터 수집 시작", "header")
            self.sig_log.emit("═" * 50, "header")
            self._collect("P", csv_files, 1)

        if self._stop:
            self.sig_finished.emit("중단됨")
        else:
            self.sig_finished.emit("전체 완료 ✅")

# ─────────────────────────────────────────────
# 색상 팔레트
# ─────────────────────────────────────────────
C = {
    "bg":       "#0f1117",
    "panel":    "#1a1d27",
    "border":   "#2a2d3a",
    "accent":   "#4f8ef7",
    "accent2":  "#7c5cbf",
    "ok":       "#3ec97a",
    "warn":     "#f5a623",
    "error":    "#f05e5e",
    "skip":     "#5a6080",
    "header":   "#c5ceff",
    "text":     "#d0d5f0",
    "dim":      "#6b7094",
    "gauge_bg": "#1e2235",
    "r_color":  "#4f8ef7",
    "p_color":  "#7c5cbf",
}

LOG_COLORS = {
    "info":   C["text"],
    "ok":     C["ok"],
    "warn":   C["warn"],
    "error":  C["error"],
    "skip":   C["skip"],
    "header": C["header"],
}

# ─────────────────────────────────────────────
# 커스텀 위젯들
# ─────────────────────────────────────────────
class GaugeBar(QWidget):
    """API 한도 게이지"""
    def __init__(self, label: str, color: str, limit: int, parent=None):
        super().__init__(parent)
        self.limit = limit
        self._value = 0
        self.setMinimumHeight(56)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(4)

        self.title_row = QHBoxLayout()
        self.lbl_name = QLabel(label)
        self.lbl_name.setStyleSheet(f"color:{C['dim']}; font-size:11px; font-weight:600;")
        self.lbl_val  = QLabel("0 / 0")
        self.lbl_val.setStyleSheet(f"color:{color}; font-size:11px; font-weight:700;")
        self.title_row.addWidget(self.lbl_name)
        self.title_row.addStretch()
        self.title_row.addWidget(self.lbl_val)
        layout.addLayout(self.title_row)

        self.bar = QProgressBar()
        self.bar.setRange(0, limit)
        self.bar.setValue(0)
        self.bar.setTextVisible(False)
        self.bar.setFixedHeight(8)
        self.bar.setStyleSheet(f"""
            QProgressBar {{
                background: {C['gauge_bg']};
                border-radius: 4px;
                border: none;
            }}
            QProgressBar::chunk {{
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                    stop:0 {color}, stop:1 {color}cc);
                border-radius: 4px;
            }}
        """)
        layout.addWidget(self.bar)

        self.lbl_pct = QLabel("0%  남은 횟수: --")
        self.lbl_pct.setStyleSheet(f"color:{C['dim']}; font-size:10px;")
        layout.addWidget(self.lbl_pct)

    def set_value(self, v: int):
        self._value = min(v, self.limit)
        self.bar.setValue(self._value)
        pct  = self._value / self.limit * 100
        left = self.limit - self._value
        color = C["ok"] if pct < 70 else C["warn"] if pct < 90 else C["error"]
        self.lbl_val.setStyleSheet(f"color:{color}; font-size:11px; font-weight:700;")
        self.lbl_val.setText(f"{self._value:,} / {self.limit:,}")
        self.lbl_pct.setText(f"{pct:.1f}%  남은 횟수: {left:,}")


class StatCard(QFrame):
    def __init__(self, icon: str, label: str, parent=None):
        super().__init__(parent)
        self.setStyleSheet(f"""
            QFrame {{
                background: {C['panel']};
                border: 1px solid {C['border']};
                border-radius: 10px;
            }}
        """)
        lay = QVBoxLayout(self)
        lay.setContentsMargins(14, 10, 14, 10)
        lay.setSpacing(2)

        row = QHBoxLayout()
        ico = QLabel(icon)
        ico.setStyleSheet("font-size:18px;")
        self.val = QLabel("—")
        self.val.setStyleSheet(f"color:{C['accent']}; font-size:20px; font-weight:800;")
        row.addWidget(ico)
        row.addStretch()
        row.addWidget(self.val)
        lay.addLayout(row)

        lbl = QLabel(label)
        lbl.setStyleSheet(f"color:{C['dim']}; font-size:10px; font-weight:600;")
        lay.addWidget(lbl)

    def set_value(self, v: str, color: str = None):
        self.val.setText(v)
        if color:
            self.val.setStyleSheet(f"color:{color}; font-size:20px; font-weight:800;")


class ColorLog(QTextEdit):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setReadOnly(True)
        self.setStyleSheet(f"""
            QTextEdit {{
                background: {C['bg']};
                color: {C['text']};
                border: 1px solid {C['border']};
                border-radius: 8px;
                padding: 10px;
                font-family: 'D2Coding', 'Consolas', 'Courier New', monospace;
                font-size: 12px;
                selection-background-color: {C['accent']}44;
            }}
        """)

    def append_colored(self, text: str, level: str = "info"):
        color = LOG_COLORS.get(level, C["text"])
        cursor = self.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        self.setTextCursor(cursor)
        self.insertHtml(
            f'<span style="color:{color};">{text.replace("<","&lt;").replace(">","&gt;").replace(chr(10),"<br>")}</span><br>'
        )
        self.verticalScrollBar().setValue(self.verticalScrollBar().maximum())

# ─────────────────────────────────────────────
# 메인 윈도우
# ─────────────────────────────────────────────
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("🏠 MP 부동산 데이터 수집기")
        self.setMinimumSize(860, 700)
        self.resize(960, 760)
        self._worker: WorkerThread | None = None
        self._start_time: datetime | None = None
        self._api_total = 0

        self._apply_global_style()
        self._build_ui()

    # ── 전역 스타일 ──
    def _apply_global_style(self):
        self.setStyleSheet(f"""
            QMainWindow, QWidget {{
                background: {C['bg']};
                color: {C['text']};
                font-family: '맑은 고딕', 'Noto Sans KR', sans-serif;
            }}
            QPushButton {{
                border-radius: 8px;
                font-weight: 700;
                font-size: 13px;
                padding: 9px 20px;
            }}
            QPushButton#start_r {{
                background: {C['r_color']};
                color: white;
                border: none;
            }}
            QPushButton#start_r:hover {{ background: #6fa8ff; }}
            QPushButton#start_p {{
                background: {C['p_color']};
                color: white;
                border: none;
            }}
            QPushButton#start_p:hover {{ background: #9b7de0; }}
            QPushButton#start_rp {{
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                    stop:0 {C['r_color']}, stop:1 {C['p_color']});
                color: white;
                border: none;
            }}
            QPushButton#start_rp:hover {{ opacity:0.85; }}
            QPushButton#stop_btn {{
                background: {C['error']}22;
                color: {C['error']};
                border: 1px solid {C['error']}66;
            }}
            QPushButton#stop_btn:hover {{ background: {C['error']}44; }}
            QPushButton:disabled {{ opacity: 0.4; }}
            QLabel {{ color: {C['text']}; }}
            QProgressBar {{
                background: {C['gauge_bg']};
                border-radius: 5px;
                border: none;
                height: 10px;
            }}
            QProgressBar::chunk {{
                border-radius: 5px;
                background: {C['accent']};
            }}
            QFrame#card {{
                background: {C['panel']};
                border: 1px solid {C['border']};
                border-radius: 12px;
            }}
            QScrollBar:vertical {{
                background: {C['panel']};
                width: 6px;
                border-radius: 3px;
            }}
            QScrollBar::handle:vertical {{
                background: {C['border']};
                border-radius: 3px;
                min-height: 30px;
            }}
        """)

    # ── UI 빌드 ──
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(18, 14, 18, 14)
        root.setSpacing(12)

        # ── 헤더 ──
        header = QHBoxLayout()
        title  = QLabel("🏠  MP 부동산 데이터 수집기")
        title.setStyleSheet(f"font-size:18px; font-weight:800; color:{C['header']};")
        sub    = QLabel("실거래(R) + 분양권(P) 통합 수집 시스템")
        sub.setStyleSheet(f"font-size:11px; color:{C['dim']}; margin-top:3px;")
        th = QVBoxLayout()
        th.addWidget(title)
        th.addWidget(sub)
        header.addLayout(th)
        header.addStretch()

        self.lbl_time = QLabel("00:00:00")
        self.lbl_time.setStyleSheet(f"font-size:22px; font-weight:800; color:{C['accent']}; font-family:monospace;")
        header.addWidget(self.lbl_time)
        root.addLayout(header)

        # ── 구분선 ──
        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setStyleSheet(f"border:none; border-top:1px solid {C['border']};")
        root.addWidget(line)

        # ── 스탯 카드 4개 ──
        cards = QHBoxLayout()
        cards.setSpacing(10)
        self.card_total   = StatCard("📁", "전체 지역 수")
        self.card_done    = StatCard("✅", "완료")
        self.card_skip    = StatCard("⏭", "스킵")
        self.card_eta     = StatCard("⏱", "예상 남은 시간")
        for c in (self.card_total, self.card_done, self.card_skip, self.card_eta):
            cards.addWidget(c)
        root.addLayout(cards)

        # ── 전체 진행률 ──
        prog_card = QFrame()
        prog_card.setObjectName("card")
        prog_lay = QVBoxLayout(prog_card)
        prog_lay.setContentsMargins(14, 12, 14, 12)
        prog_lay.setSpacing(8)

        row1 = QHBoxLayout()
        lbl_prog = QLabel("전체 진행률")
        lbl_prog.setStyleSheet(f"font-weight:700; color:{C['header']}; font-size:12px;")
        self.lbl_prog_pct = QLabel("0%")
        self.lbl_prog_pct.setStyleSheet(f"font-weight:800; color:{C['accent']}; font-size:13px;")
        row1.addWidget(lbl_prog)
        row1.addStretch()
        row1.addWidget(self.lbl_prog_pct)
        prog_lay.addLayout(row1)

        self.progress_total = QProgressBar()
        self.progress_total.setRange(0, 100)
        self.progress_total.setValue(0)
        self.progress_total.setTextVisible(False)
        self.progress_total.setFixedHeight(14)
        self.progress_total.setStyleSheet(f"""
            QProgressBar {{
                background: {C['gauge_bg']};
                border-radius: 7px;
                border: none;
            }}
            QProgressBar::chunk {{
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                    stop:0 {C['r_color']}, stop:1 {C['p_color']});
                border-radius: 7px;
            }}
        """)
        prog_lay.addWidget(self.progress_total)

        self.lbl_current = QLabel("대기 중...")
        self.lbl_current.setStyleSheet(f"color:{C['dim']}; font-size:11px;")
        prog_lay.addWidget(self.lbl_current)
        root.addWidget(prog_card)

        # ── API 게이지 ──
        api_card = QFrame()
        api_card.setObjectName("card")
        api_lay = QVBoxLayout(api_card)
        api_lay.setContentsMargins(14, 12, 14, 12)
        api_lay.setSpacing(10)
        lbl_api = QLabel("API 일일 한도 현황")
        lbl_api.setStyleSheet(f"font-weight:700; color:{C['header']}; font-size:12px;")
        api_lay.addWidget(lbl_api)
        self.gauge = GaugeBar("누적 API 요청", C["accent"], API_LIMIT)
        api_lay.addWidget(self.gauge)
        root.addWidget(api_card)

        # ── 버튼 영역 ──
        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)

        self.btn_r  = QPushButton("▶  실거래(R) 수집")
        self.btn_p  = QPushButton("▶  분양권(P) 수집")
        self.btn_rp = QPushButton("▶  R + P 통합 수집")
        self.btn_stop = QPushButton("⏹  중지")

        self.btn_r.setObjectName("start_r")
        self.btn_p.setObjectName("start_p")
        self.btn_rp.setObjectName("start_rp")
        self.btn_stop.setObjectName("stop_btn")

        self.btn_r.clicked.connect(lambda: self._start("R"))
        self.btn_p.clicked.connect(lambda: self._start("P"))
        self.btn_rp.clicked.connect(lambda: self._start("RP"))
        self.btn_stop.clicked.connect(self._stop)

        self.btn_stop.setEnabled(False)
        for b in (self.btn_r, self.btn_p, self.btn_rp, self.btn_stop):
            btn_row.addWidget(b)
        root.addLayout(btn_row)

        # ── 로그 ──
        self.log = ColorLog()
        root.addWidget(self.log, 1)

        # ── 타이머 (경과시간) ──
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._tick)

        # ── 초기 메시지 ──
        self.log.append_colored("MP 부동산 데이터 수집기가 준비됐습니다.", "ok")
        self.log.append_colored(f"KaptList 폴더의 *_list_coord.csv 파일을 자동 탐지합니다.", "info")
        self.log.append_colored(f"KaptList 경로: {KAPT_LIST_DIR}", "info")
        self.log.append_colored(f"Rdata 저장 경로: {RDATA_DIR}", "info")
        self.log.append_colored(f"Pdata 저장 경로: {PDATA_DIR}", "info")
        self.log.append_colored(f"API 일일 한도: {API_LIMIT:,}회 / R 시작연월 기본값: 2006년 1월", "info")

    # ── 타이머 tick ──
    def _tick(self):
        if self._start_time:
            elapsed = datetime.now() - self._start_time
            h, rem = divmod(int(elapsed.total_seconds()), 3600)
            m, s   = divmod(rem, 60)
            self.lbl_time.setText(f"{h:02d}:{m:02d}:{s:02d}")

    # ── 수집 시작 ──
    def _start(self, mode: str):
        csv_files = list_csv_files()
        if not csv_files:
            self.log.append_colored(f"⚠ KaptList 폴더에 *_list_coord.csv 파일이 없습니다.\n   경로: {KAPT_LIST_DIR}", "warn")
            return

        total = len(csv_files)
        self.card_total.set_value(str(total))
        self.card_done.set_value("0")
        self.card_skip.set_value("0")
        self.card_eta.set_value("—")
        self._done_cnt = 0
        self._skip_cnt = 0
        self._total_cnt = total * (2 if mode == "RP" else 1)
        self.progress_total.setValue(0)
        self.lbl_prog_pct.setText("0%")

        self.log.clear()
        self.log.append_colored(f"{'R+P 통합' if mode=='RP' else ('실거래(R)' if mode=='R' else '분양권(P)')} 수집 시작  [{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]", "header")

        self._start_time = datetime.now()
        self._timer.start(1000)

        skip_h = 24 if mode == "R" else 12

        self._worker = WorkerThread(mode, skip_h)
        self._worker.sig_log.connect(self._on_log)
        self._worker.sig_progress.connect(self._on_progress)
        self._worker.sig_api.connect(self._on_api)
        self._worker.sig_item_done.connect(self._on_item_done)
        self._worker.sig_finished.connect(self._on_finished)
        self._worker.sig_eta.connect(self._on_eta)
        self._worker.start()

        for b in (self.btn_r, self.btn_p, self.btn_rp):
            b.setEnabled(False)
        self.btn_stop.setEnabled(True)

    # ── 중지 ──
    def _stop(self):
        if self._worker:
            self._worker.stop()
        self.log.append_colored("\n⏹ 중지 요청됨...", "warn")

    # ── 시그널 핸들러 ──
    def _on_log(self, msg: str, level: str):
        self.log.append_colored(msg, level)
        self.lbl_current.setText(msg.strip()[:80])

    def _on_progress(self, idx: int, total: int, pct: int, type_idx: int):
        # 전체 진행률 계산
        if self._total_cnt > 0:
            offset = (idx - 1 + pct / 100) / total
            if type_idx == 1:  # P는 R 완료 후 시작
                offset = 0.5 + offset * 0.5
            else:
                offset = offset * (0.5 if hasattr(self, '_total_cnt') and self._total_cnt > len(list_csv_files()) else 1.0)
            overall = int(offset * 100)
            self.progress_total.setValue(min(overall, 100))
            self.lbl_prog_pct.setText(f"{min(overall,100)}%")

    def _on_api(self, total: int):
        self._api_total = total
        self.gauge.set_value(total)

    def _on_item_done(self, label: str, success: bool):
        self._done_cnt += 1
        self.card_done.set_value(str(self._done_cnt), C["ok"])

    def _on_eta(self, eta_sec: int):
        if eta_sec <= 0:
            self.card_eta.set_value("—")
            return
        h, rem = divmod(eta_sec, 3600)
        m, s   = divmod(rem, 60)
        if h > 0:
            self.card_eta.set_value(f"{h}h {m}m", C["warn"])
        else:
            self.card_eta.set_value(f"{m}m {s}s", C["ok"])

    def _on_finished(self, msg: str):
        self._timer.stop()
        self.log.append_colored(f"\n{'='*48}", "header")
        self.log.append_colored(f"  {msg}", "ok" if "완료" in msg else "warn")
        self.log.append_colored(f"  누적 API 요청: {self._api_total:,}회", "info")
        self.log.append_colored(f"{'='*48}", "header")

        self.progress_total.setValue(100)
        self.lbl_prog_pct.setText("100%")
        self.lbl_current.setText(msg)
        self.card_eta.set_value("완료", C["ok"])

        for b in (self.btn_r, self.btn_p, self.btn_rp):
            b.setEnabled(True)
        self.btn_stop.setEnabled(False)

    def closeEvent(self, e):
        if self._worker and self._worker.isRunning():
            self._worker.stop()
            self._worker.wait(3000)
        e.accept()

# ─────────────────────────────────────────────
# 진입점
# ─────────────────────────────────────────────
def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")

    palette = QPalette()
    palette.setColor(QPalette.ColorRole.Window,          QColor(C["bg"]))
    palette.setColor(QPalette.ColorRole.WindowText,      QColor(C["text"]))
    palette.setColor(QPalette.ColorRole.Base,            QColor(C["panel"]))
    palette.setColor(QPalette.ColorRole.AlternateBase,   QColor(C["border"]))
    palette.setColor(QPalette.ColorRole.Text,            QColor(C["text"]))
    palette.setColor(QPalette.ColorRole.Button,          QColor(C["panel"]))
    palette.setColor(QPalette.ColorRole.ButtonText,      QColor(C["text"]))
    palette.setColor(QPalette.ColorRole.Highlight,       QColor(C["accent"]))
    palette.setColor(QPalette.ColorRole.HighlightedText, QColor("#ffffff"))
    app.setPalette(palette)

    win = MainWindow()
    win.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
