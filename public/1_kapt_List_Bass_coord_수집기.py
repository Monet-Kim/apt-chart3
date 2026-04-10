# -*- coding: utf-8 -*-
"""
KAPT 통합 데이터 수집기  v2.0
══════════════════════════════════════════════════════════════════
3단계 순차 처리 (Phase 완료 후 다음 Phase 진행)

  Phase 1  법정동코드 전체자료.txt → 시군구 목록 API
           → KaptList/*.csv  (Step1 컬럼만: kaptCode, kaptName, bjdCode, as1, as2, as3, as4)

  Phase 2  Phase1 CSV의 kaptCode → AptBasisInfoServiceV4 API
           → 동일 파일에 ITEM_KEYS 컬럼 추가 (kaptAddr, doroJuso 등 전체, DROP_KEYS 없음)

  Phase 3  Phase2 CSV의 kaptAddr/doroJuso → 카카오 주소 API
           → 동일 파일 마지막에 위도·경도 컬럼 추가

재실행 시:
  Phase 1  kaptCode 기준 신규 단지만 행 추가
  Phase 2  kaptAddr 비어있는 행만 Bass API 재호출
  Phase 3  위도/경도 비어있는 행만 카카오 재호출

출력 폴더: (이 파일 위치) / KaptList /
파일명:    {시도}_{시군구}_{코드}_list_coord.csv
══════════════════════════════════════════════════════════════════
"""

import sys, re, time, html, csv, logging, traceback, json, gzip
from datetime import datetime, timezone
import requests
import boto3
import pandas as pd
from pathlib import Path

from PyQt6.QtWidgets import (
    QApplication, QMainWindow, QWidget,
    QVBoxLayout, QHBoxLayout,
    QPushButton, QLabel, QTextEdit, QProgressBar,
    QFrame, QGroupBox,
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui  import QFont, QTextCursor


# ══════════════════════════════════════════════════════════════════
#  설정
# ══════════════════════════════════════════════════════════════════
SERVICE_KEY = "HcVtWuaWvdDSFSZQtcDh5WXItVvZ9Wof23DGfIzh0fUEGb9v06BprdP6QIPK2rVTVsHKx9i3WgsXWYXOZE4vbg=="
LIST_URL    = "http://apis.data.go.kr/1613000/AptListService3/getSigunguAptList3"
BASS_URL    = "http://apis.data.go.kr/1613000/AptBasisInfoServiceV4/getAphusBassInfoV4"
KAKAO_KEY         = "8d96a5618bd5f430218b25347d0382c7"
KAKAO_URL         = "https://dapi.kakao.com/v2/local/search/address.json"
KAKAO_KEYWORD_URL = "https://dapi.kakao.com/v2/local/search/keyword.json"

R2_ACCESS_KEY = "71e270652969acf7a661d46404a196c6"
R2_SECRET_KEY = "e0bdd25cd87d66f24a08e7d98387196fa2316bec40d8fe3b0426aa308fa609d4"
R2_ENDPOINT   = "https://485ad5b19488023956187106c5f363d2.r2.cloudflarestorage.com"
R2_BUCKET     = "apt-chart-data"

LIST_LIMIT  = 10_000
BASS_LIMIT  = 1_000_000

BASE_DIR   = Path(__file__).parent
OUTPUT_DIR = BASE_DIR / "KaptList"
LOG_DIR    = BASE_DIR / "logs"

def _setup_logger() -> logging.Logger:
    LOG_DIR.mkdir(exist_ok=True)
    log_file = LOG_DIR / f"kapt_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"
    logger = logging.getLogger("kapt")
    logger.setLevel(logging.DEBUG)
    fh = logging.FileHandler(log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S"))
    logger.addHandler(fh)
    return logger

logger = _setup_logger()

def _excepthook(exc_type, exc_value, exc_tb):
    msg = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
    logger.critical(f"예기치 않은 오류로 종료\n{msg}")
    sys.__excepthook__(exc_type, exc_value, exc_tb)

sys.excepthook = _excepthook

# Bass API 반환 필드 고정 순서 (DROP_KEYS 없음, 전체 포함)
ITEM_KEYS = [
    "kaptCode", "kaptName", "kaptAddr", "codeSaleNm", "codeHeatNm",
    "kaptTarea", "kaptDongCnt", "kaptdaCnt", "kaptBcompany", "kaptAcompany",
    "kaptTel", "kaptUrl", "codeAptNm", "doroJuso", "codeMgrNm",
    "codeHallNm", "kaptUsedate", "kaptFax", "hoCnt", "kaptMarea",
    "kaptMparea60", "kaptMparea85", "kaptMparea135", "kaptMparea136",
    "privArea", "bjdCode", "kaptTopFloor", "ktownFlrNo",
    "kaptBaseFloor", "kaptdEcntp", "zipcode",
]

COORD_COLS = ["위도", "경도"]   # 항상 마지막 두 컬럼

# Phase 1 CSV 컬럼 (목록 API 반환 필드 그대로)
PHASE1_COLS = ["kaptCode", "kaptName", "bjdCode", "as1", "as2", "as3", "as4"]

_law_cands = [
    BASE_DIR / "법정동코드 전체자료.txt",
    BASE_DIR / "step1_Kapt_list" / "법정동코드 전체자료.txt",
]
LAW_CODE = next((p for p in _law_cands if p.exists()), _law_cands[0])


# ══════════════════════════════════════════════════════════════════
#  지역 목록 생성 (kapt_list_API_maker.py 로직 동일)
# ══════════════════════════════════════════════════════════════════
def load_regions() -> list:
    rows = []
    for enc in ("cp949", "euc-kr", "utf-8"):
        try:
            with open(LAW_CODE, "r", encoding=enc) as f:
                for line in f:
                    p = line.strip().split()
                    if len(p) >= 3:
                        rows.append((p[0], " ".join(p[1:-1]), p[-1]))
            break
        except (UnicodeDecodeError, FileNotFoundError):
            continue
    if not rows:
        raise FileNotFoundError(f"법정동코드 파일을 찾을 수 없습니다: {LAW_CODE}")

    df = pd.DataFrame(rows, columns=["code", "name", "status"])
    df = df[df["status"].str.strip() == "존재"].copy()
    df["parts"] = df["name"].str.split()
    df["depth"] = df["parts"].str.len()
    df["last"]  = df["parts"].str[-1]
    df["c5"]    = df["code"].str[:5]

    gu_df    = df[df["last"].str.endswith("구")].copy()
    deep3_gu = gu_df[gu_df["depth"] == 3].copy()
    deep3_gu["par4"] = deep3_gu["code"].str[:4]

    blocked = set()
    for _, r in deep3_gu.iterrows():
        blocked.update(
            df[(df["depth"] == 2) & (df["code"].str[:4] == r["par4"])]["c5"].tolist()
        )

    result, seen = [], set()

    for _, r in gu_df.iterrows():
        c5 = r["c5"]
        if c5 in seen:
            continue
        seen.add(c5)
        p = r["parts"]
        if len(p) == 2:
            sido, gu = p
            fname = f"{sido}_{gu}_{c5}_list_coord.csv"
            sigungu = gu
        elif len(p) == 3:
            sido, si, gu = p
            fname = f"{sido}_{si}_{gu}_{c5}_list_coord.csv"
            sigungu = f"{si}_{gu}"
        else:
            continue
        result.append(dict(c5=c5, sido=sido, sigungu=sigungu, fname=fname, name=r["name"]))

    for _, r in df[(df["depth"] == 2) & (~df["last"].str.endswith("구"))].iterrows():
        c5 = r["c5"]
        if c5 in seen or c5 in blocked:
            continue
        seen.add(c5)
        p = r["parts"]
        if len(p) == 2:
            sido, sigungu = p
            fname = f"{sido}_{sigungu}_{c5}_list_coord.csv"
        elif len(p) == 1:
            sido, sigungu = p[0], ""
            fname = f"{sido}_{c5}_list_coord.csv"
        else:
            continue
        result.append(dict(c5=c5, sido=sido, sigungu=sigungu, fname=fname, name=r["name"]))

    return sorted(result, key=lambda x: x["c5"])


# ══════════════════════════════════════════════════════════════════
#  API 호출
# ══════════════════════════════════════════════════════════════════
def fetch_apt_list(code5: str) -> tuple:
    """목록 API → (items: list[dict], n_requests: int)"""
    items, page, n_req = [], 1, 0
    while True:
        try:
            r = requests.get(LIST_URL, params={
                "serviceKey": SERVICE_KEY, "sigunguCode": code5,
                "pageNo": page, "numOfRows": 1000, "returnType": "json",
            }, timeout=15)
            n_req += 1
            body  = r.json().get("response", {}).get("body", {})
            total = int(body.get("totalCount") or 0)
            cur   = body.get("items") or []
            if isinstance(cur, dict):
                cur = [cur]
            items.extend(cur)
            if not cur or len(items) >= total:
                break
            page += 1
        except Exception as e:
            logger.error(f"[fetch_apt_list] code5={code5} page={page} 오류: {e}\n{traceback.format_exc()}")
            break
    return items, n_req


def fetch_bass_info(kapt_code: str, retries: int = 3) -> dict:
    """단지 기본정보 API V4 → 전체 필드 dict"""
    for i in range(retries):
        try:
            r = requests.get(BASS_URL, params={
                "serviceKey": SERVICE_KEY, "kaptCode": kapt_code,
                "pageNo": 1, "numOfRows": 5, "returnType": "json",
            }, timeout=10)
            if r.status_code != 200:
                logger.warning(f"[fetch_bass_info] kaptCode={kapt_code} HTTP {r.status_code} (시도 {i+1}/{retries})")
            item = r.json().get("response", {}).get("body", {}).get("item", {})
            time.sleep(0.1)
            return item if isinstance(item, dict) else {}
        except Exception as e:
            logger.error(f"[fetch_bass_info] kaptCode={kapt_code} 시도 {i+1}/{retries} 오류: {e}\n{traceback.format_exc()}")
            time.sleep(0.3 * (i + 1))
    logger.error(f"[fetch_bass_info] kaptCode={kapt_code} {retries}회 재시도 모두 실패 — 빈 dict 반환")
    return {}


def _kakao_keyword_req(query: str) -> tuple:
    """카카오 키워드 검색 API → (lat, lng)  ※ 단지명 검색 전용"""
    if not query.strip():
        return "", ""
    try:
        time.sleep(0.05)
        r = requests.get(KAKAO_KEYWORD_URL,
            headers={"Authorization": f"KakaoAK {KAKAO_KEY}"},
            params={"query": query, "category_group_code": "AD5"}, timeout=5)
        if r.status_code == 401:
            logger.critical(f"[카카오 키워드] 인증 실패 (401). query={query}")
            return "", ""
        if r.status_code == 429:
            logger.warning(f"[카카오 키워드] 일일 한도 초과 (429). query={query}")
            return "", ""
        if r.status_code != 200:
            logger.warning(f"[카카오 키워드] HTTP {r.status_code}. query={query}")
            return "", ""
        docs = r.json().get("documents", [])
        if docs:
            return docs[0].get("y", ""), docs[0].get("x", "")
    except Exception as e:
        logger.error(f"[카카오 키워드] 요청 오류: {e} query={query}\n{traceback.format_exc()}")
    return "", ""


def _kakao_req(query: str) -> tuple:
    """카카오 주소 API → (lat, lng)"""
    if not query.strip():
        return "", ""
    try:
        time.sleep(0.05)
        r = requests.get(KAKAO_URL,
            headers={"Authorization": f"KakaoAK {KAKAO_KEY}"},
            params={"query": query}, timeout=5)
        if r.status_code == 401:
            logger.critical(f"[카카오] 인증 실패 (401) — API 키를 확인하세요. query={query}")
            return "", ""
        if r.status_code == 429:
            logger.warning(f"[카카오] 일일 한도 초과 (429). query={query}")
            return "", ""
        if r.status_code != 200:
            logger.warning(f"[카카오] HTTP {r.status_code}. query={query}")
            return "", ""
        docs = r.json().get("documents", [])
        if not docs:
            logger.debug(f"[카카오] 검색 결과 없음. query={query}")
        if docs:
            doc  = docs[0]
            road = doc.get("road_address") or {}
            addr = doc.get("address") or {}
            return (road.get("y") or addr.get("y") or ""), \
                   (road.get("x") or addr.get("x") or "")
    except Exception as e:
        logger.error(f"[카카오] 요청 오류: {e} query={query}\n{traceback.format_exc()}")
    return "", ""


def _clean_addr(addr: str) -> str:
    """주소에서 번지까지만 추출"""
    m = re.search(r"(\d+-\d+)", addr)
    if m:
        return addr[: addr.index(m.group(0))] + m.group(0)
    m = re.search(r"(\d+)-", addr)
    if m:
        return addr[: addr.index(m.group(0))] + m.group(1)
    m = re.search(r"^(.*\d+)\D", addr + " ")
    return m.group(1) if m else addr


def geocode(row: dict) -> tuple:
    """단지명(키워드) → doroJuso → kaptAddr 순으로 좌표 시도 (도로명 우선) → (lat, lng, n_calls)"""
    calls = 0

    # 1순위: 단지명 + 지역(as1 + as3 or as2) → 키워드 검색 API
    kname  = str(row.get("kaptName") or "").strip()
    as1    = str(row.get("as1") or "").strip()
    region = str(row.get("as3") or row.get("as2") or "").strip()
    if kname:
        q = f"{as1} {region} {kname}".strip()
        calls += 1
        lat, lng = _kakao_keyword_req(q)
        if lat and lng:
            return lat, lng, calls

    # 2순위: doroJuso → 주소 검색 API
    for key in ("doroJuso", "kaptAddr"):
        val = str(row.get(key) or "").strip()
        if not val:
            continue
        q = _clean_addr(val) if key == "kaptAddr" else val
        calls += 1
        lat, lng = _kakao_req(q)
        if lat and lng:
            return lat, lng, calls

    return "", "", calls


# ══════════════════════════════════════════════════════════════════
#  CSV 유틸
# ══════════════════════════════════════════════════════════════════
def _sanitize(v) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s.lower() in ("null", "none") else s


def _read_csv(path: Path) -> pd.DataFrame:
    try:
        return pd.read_csv(path, dtype=str, encoding="utf-8-sig").fillna("")
    except Exception:
        return pd.DataFrame()


def _save_coord_last(path: Path, df: pd.DataFrame):
    """저장 시 위도·경도를 항상 마지막 두 컬럼으로 고정"""
    base = [c for c in df.columns if c not in COORD_COLS]
    tail = [c for c in COORD_COLS if c in df.columns]
    df[base + tail].to_csv(path, index=False, encoding="utf-8-sig")


# ── Phase 1 저장: PHASE1_COLS 만 기록 ────────────────────────────
def _phase1_save(path: Path, new_items: list):
    """
    신규 아파트 목록을 CSV에 추가.
    파일이 없으면 새로 생성, 있으면 신규 행만 append.
    """
    if not new_items:
        return
    file_exists = path.exists()
    with open(path, "a", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=PHASE1_COLS,
            extrasaction="ignore",   # as4=null 등 불필요 키 무시
        )
        if not file_exists:
            writer.writeheader()
        for item in new_items:
            writer.writerow({k: _sanitize(item.get(k)) for k in PHASE1_COLS})


# ── Phase 2 대상 행 인덱스: kaptAddr 비어있는 행 ─────────────────
def _phase2_pending(df: pd.DataFrame) -> list:
    if "kaptAddr" not in df.columns:
        return list(range(len(df)))
    return df.index[df["kaptAddr"].str.strip() == ""].tolist()


# ── Phase 3 대상 행 인덱스: 위도 또는 경도 비어있는 행 ───────────
def _phase3_pending(df: pd.DataFrame) -> list:
    if "위도" not in df.columns or "경도" not in df.columns:
        return list(range(len(df)))
    mask = (df["위도"].str.strip() == "") | (df["경도"].str.strip() == "")
    return df.index[mask].tolist()


# ══════════════════════════════════════════════════════════════════
#  수집 워커 스레드
# ══════════════════════════════════════════════════════════════════
class CollectorWorker(QThread):
    s_log     = pyqtSignal(str, str)       # (message, level)
    s_phase   = pyqtSignal(int, str)       # (phase_num, phase_title)
    s_prog1   = pyqtSignal(int, int, str)  # (current, total, label) ← 상단 바
    s_prog2   = pyqtSignal(int, int)       # (current, total)        ← 하단 바
    s_api     = pyqtSignal(int, int, int)  # (n_list, n_bass, n_kakao)
    s_done    = pyqtSignal(str)
    s_r2log   = pyqtSignal(str, str)   # R2 업로드 로그 (message, level)

    def __init__(self, regions: list, start_phase: int = 1, end_phase: int = 4):
        super().__init__()
        self.regions     = regions
        self._stop       = False
        self.n_list      = self.n_bass = self.n_kakao = 0
        self.n_upload    = 0
        self.start_phase = start_phase
        self.end_phase   = end_phase

    def stop(self):
        self._stop = True

    def _emit_api(self):
        self.s_api.emit(self.n_list, self.n_bass, self.n_kakao)

    # ── run ───────────────────────────────────────────────────────
    def run(self):
        try:
            self._run_inner()
        except Exception as e:
            msg = f"수집 스레드 예기치 않은 오류로 중단: {e}\n{traceback.format_exc()}"
            logger.critical(msg)
            self.s_log.emit(f"❌ 치명적 오류: {e}", "warn")
            self._finish()

    def _run_inner(self):
        OUTPUT_DIR.mkdir(exist_ok=True)
        for phase in range(self.start_phase, self.end_phase + 1):
            if self._stop:
                break
            if   phase == 1: self._phase1()
            elif phase == 2: self._phase2()
            elif phase == 3: self._phase3()
            elif phase == 4: self._phase4()
        self._finish()

    # ── Phase 1: 아파트 목록 수집 ────────────────────────────────
    def _phase1(self):
        self.s_phase.emit(1, "Phase 1  아파트 목록 수집")
        self.s_log.emit("══ Phase 1: 아파트 목록 수집 ══════════════════", "header")
        total = len(self.regions)

        for idx, reg in enumerate(self.regions, 1):
            if self._stop: break
            if self.n_list >= LIST_LIMIT:
                self.s_log.emit("⚠ 목록 API 일일 한도 초과. Phase 1 중단.", "warn"); break

            c5, name, path = reg["c5"], reg["name"], OUTPUT_DIR / reg["fname"]
            self.s_prog1.emit(idx, total, name)

            apt_items, n_req = fetch_apt_list(c5)
            self.n_list += n_req
            self._emit_api()

            if not apt_items:
                self.s_log.emit(f"  [{idx}/{total}] {name} — 목록 없음 (요청 {n_req}회)", "skip"); continue

            existing_codes: set = set()
            if path.exists():
                df_ex = _read_csv(path)
                if "kaptCode" in df_ex.columns:
                    existing_codes = set(df_ex["kaptCode"].str.strip())

            new_items = [it for it in apt_items if _sanitize(it.get("kaptCode")) not in existing_codes]
            if not new_items:
                self.s_log.emit(f"  [{idx}/{total}] {name} — 기존 {len(existing_codes)}개 (신규 없음)", "skip"); continue

            _phase1_save(path, new_items)
            self.s_log.emit(
                f"  [{idx}/{total}] {name} — +{len(new_items)}개 저장"
                f"  (누계 {len(existing_codes) + len(new_items)}개, API {n_req}회)", "ok")

    # ── Phase 2: 단지 기본정보 추가 ──────────────────────────────
    def _phase2(self):
        self.s_phase.emit(2, "Phase 2  단지 기본정보 추가")
        self.s_log.emit("══ Phase 2: 단지 기본정보 추가 ══════════════════", "header")
        csv_files = sorted(OUTPUT_DIR.glob("*_list_coord.csv"))
        total_f   = len(csv_files)

        for fi, path in enumerate(csv_files, 1):
            if self._stop: break
            df      = _read_csv(path)
            pending = _phase2_pending(df)
            self.s_prog1.emit(fi, total_f, path.name)
            if not pending:
                self.s_log.emit(f"  [{fi}/{total_f}] {path.name} — 기본정보 완료 (skip)", "skip"); continue

            self.s_log.emit(f"  [{fi}/{total_f}] {path.name} — {len(pending)}행 처리 예정", "info")
            for k in ITEM_KEYS:
                if k not in df.columns: df[k] = ""

            changed = False
            for ai, row_idx in enumerate(pending, 1):
                if self._stop: break
                if self.n_bass >= BASS_LIMIT:
                    self.s_log.emit("⚠ 기본정보 API 일일 한도 초과. 중단.", "warn")
                    self._stop = True; break

                kcode, kname = df.at[row_idx, "kaptCode"], df.at[row_idx, "kaptName"]
                bass = fetch_bass_info(kcode)
                self.n_bass += 1
                self._emit_api()
                self.s_prog2.emit(ai, len(pending))

                for k in ITEM_KEYS:
                    df.at[row_idx, k] = _sanitize(bass.get(k))
                for k, v in bass.items():
                    if k not in ITEM_KEYS:
                        if k not in df.columns: df[k] = ""
                        df.at[row_idx, k] = _sanitize(v)

                changed = True
                kaddr = df.at[row_idx, "kaptAddr"]
                self.s_log.emit(f"    [{ai}/{len(pending)}] {kname} [{kcode}]  {kaddr[:30] if kaddr else '주소없음'}", "data")

            if changed:
                _save_coord_last(path, df)
                self.s_log.emit(f"  ✅ {path.name} 저장 완료", "ok")

    # ── Phase 3: 좌표 추가 ───────────────────────────────────────
    def _phase3(self):
        self.s_phase.emit(3, "Phase 3  좌표 추가")
        self.s_log.emit("══ Phase 3: 좌표 추가 ══════════════════════════", "header")
        csv_files = sorted(OUTPUT_DIR.glob("*_list_coord.csv"))
        total_f   = len(csv_files)

        for fi, path in enumerate(csv_files, 1):
            if self._stop: break
            df      = _read_csv(path)
            pending = _phase3_pending(df)
            self.s_prog1.emit(fi, total_f, path.name)
            if not pending:
                self.s_log.emit(f"  [{fi}/{total_f}] {path.name} — 좌표 완료 (skip)", "skip"); continue

            self.s_log.emit(f"  [{fi}/{total_f}] {path.name} — {len(pending)}행 처리 예정", "info")
            if "위도" not in df.columns: df["위도"] = ""
            if "경도" not in df.columns: df["경도"] = ""

            changed = False
            for ai, row_idx in enumerate(pending, 1):
                if self._stop: break
                row_dict = df.iloc[row_idx].to_dict()
                lat, lng, kc = geocode(row_dict)
                self.n_kakao += kc
                self._emit_api()
                self.s_prog2.emit(ai, len(pending))
                df.at[row_idx, "위도"] = lat
                df.at[row_idx, "경도"] = lng
                changed = True
                kname     = df.at[row_idx, "kaptName"]
                coord_str = f"({lat[:8]}, {lng[:9]})" if lat else "좌표없음"
                self.s_log.emit(f"    [{ai}/{len(pending)}] {kname}  {coord_str}", "data")

            if changed:
                _save_coord_last(path, df)
                self.s_log.emit(f"  ✅ {path.name} 저장 완료", "ok")

    # ── Phase 4: R2 업로드 (gzip 압축 후 업로드) ─────────────────
    def _phase4(self):
        self.s_phase.emit(4, "Phase 4  R2 업로드")
        self.s_log.emit("══ Phase 4: Cloudflare R2 업로드 ══════════════════", "header")
        try:
            # code5_map.json 갱신
            pat = re.compile(r"(.+)_(\d{5})_list_coord\.csv$")
            mapping = {}
            for f in OUTPUT_DIR.glob("*_list_coord.csv"):
                m = pat.search(f.name)
                if m: mapping[m.group(2)] = f.name
            map_path = OUTPUT_DIR / "code5_map.json"
            with open(map_path, "w", encoding="utf-8") as fp:
                json.dump(mapping, fp, ensure_ascii=False)
            self.s_log.emit(f"  code5_map.json 갱신 완료 ({len(mapping)}개 항목)", "ok")

            s3 = boto3.client("s3",
                endpoint_url=R2_ENDPOINT,
                aws_access_key_id=R2_ACCESS_KEY,
                aws_secret_access_key=R2_SECRET_KEY,
            )

            self.s_log.emit("  R2 파일 목록 확인 중...", "info")
            existing = {}
            paginator = s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=R2_BUCKET, Prefix="KaptList/"):
                for obj in page.get("Contents", []):
                    existing[obj["Key"]] = obj["LastModified"]
            self.s_log.emit(f"  R2 기존 파일: {len(existing):,}개", "info")

            files = [f for f in sorted(OUTPUT_DIR.glob("*")) if f.is_file() and f.suffix != ".py"]
            total_f = len(files)
            uploaded = skipped = 0

            for i, file_path in enumerate(files, 1):
                if self._stop: break
                # json은 그대로, csv는 gzip 압축해서 .csv.gz로 업로드
                if file_path.suffix == ".csv":
                    gz_key = f"KaptList/{file_path.stem}.csv.gz"
                    local_dt = datetime.fromtimestamp(file_path.stat().st_mtime, tz=timezone.utc)
                    if gz_key in existing and local_dt <= existing[gz_key]:
                        skipped += 1; continue
                    self.s_prog1.emit(i, total_f, file_path.name)
                    with open(file_path, "rb") as f_in:
                        compressed = gzip.compress(f_in.read())
                    s3.put_object(Bucket=R2_BUCKET, Key=gz_key, Body=compressed,
                        ContentType="application/gzip")
                else:
                    key = f"KaptList/{file_path.name}"
                    local_dt = datetime.fromtimestamp(file_path.stat().st_mtime, tz=timezone.utc)
                    if key in existing and local_dt <= existing[key]:
                        skipped += 1; continue
                    self.s_prog1.emit(i, total_f, file_path.name)
                    s3.upload_file(str(file_path), R2_BUCKET, key)

                uploaded += 1
                self.n_upload += 1
                log_name = gz_key.split("/")[-1] if file_path.suffix == ".csv" else file_path.name
                self.s_log.emit(f"  ↑ {log_name}", "data")

            self.s_log.emit(f"  ✅ 업로드 완료  (신규/갱신: {uploaded}개 / 건너뜀: {skipped}개)", "ok")

        except Exception as e:
            self.s_log.emit(f"  ❌ R2 업로드 오류: {e}", "warn")
            logger.error(f"R2 업로드 오류: {e}\n{traceback.format_exc()}")

    def _finish(self):
        summary = (
            f"완료  │  ① 목록 {self.n_list:,}회"
            f"  │  ② 기본정보 {self.n_bass:,}회"
            f"  │  ③ 카카오 {self.n_kakao:,}회"
            f"  │  ④ R2 업로드 {self.n_upload:,}개"
        )
        self.s_done.emit(summary)


# ══════════════════════════════════════════════════════════════════
#  UI 위젯
# ══════════════════════════════════════════════════════════════════
LEVEL_COLOR = {
    "header": "#6eb0f5",
    "info":   "#c0cfe8",
    "ok":     "#69db7c",
    "warn":   "#ffa94d",
    "skip":   "#5a6a88",
    "data":   "#8fa8c0",
}

PHASE_COLOR = ["", "#4c7cf3", "#f59f00", "#40c057", "#cc5de8"]  # phase 1/2/3/4 색상


class ApiGauge(QFrame):
    def __init__(self, title: str, limit: int = 0):
        super().__init__()
        self.limit = limit
        self.setFrameShape(QFrame.Shape.StyledPanel)
        self.setStyleSheet("QFrame{background:#1a1f33;border-radius:8px;}")

        lay = QVBoxLayout(self)
        lay.setSpacing(4)
        lay.setContentsMargins(12, 8, 12, 8)

        lbl = QLabel(title)
        lbl.setFont(QFont("맑은 고딕", 9, QFont.Weight.Bold))
        lbl.setStyleSheet("color:#697ea8;")
        lay.addWidget(lbl)

        if limit:
            self.bar = QProgressBar()
            self.bar.setMaximum(limit)
            self.bar.setValue(0)
            self.bar.setTextVisible(False)
            self.bar.setFixedHeight(8)
            self._set_bar("#4c7cf3")
            lay.addWidget(self.bar)

        self.lbl_n = QLabel(f"0 / {limit:,}" if limit else "0 회")
        self.lbl_n.setFont(QFont("Consolas", 13, QFont.Weight.Bold))
        self.lbl_n.setStyleSheet("color:#dde5ff;")
        lay.addWidget(self.lbl_n)

    def _set_bar(self, color: str):
        self.bar.setStyleSheet(
            "QProgressBar{background:#252b44;border-radius:4px;}"
            f"QProgressBar::chunk{{background:{color};border-radius:4px;}}"
        )

    def set_value(self, n: int):
        if self.limit:
            self.bar.setValue(min(n, self.limit))
            pct = n / self.limit
            self._set_bar(
                "#e03131" if pct >= 1.0 else
                "#f76707" if pct >= 0.8 else "#4c7cf3"
            )
            self.lbl_n.setText(f"{n:,} / {self.limit:,}")
        else:
            self.lbl_n.setText(f"{n:,} 회")


# ══════════════════════════════════════════════════════════════════
#  메인 윈도우
# ══════════════════════════════════════════════════════════════════
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("KAPT 통합 데이터 수집기  v2")
        self.resize(1120, 860)
        self.setStyleSheet("QMainWindow,QWidget{background:#131625;}")
        self.regions = []
        self.worker  = None
        self._build_ui()
        self._load_regions()

    def _build_ui(self):
        root = QWidget()
        self.setCentralWidget(root)
        v = QVBoxLayout(root)
        v.setSpacing(8)
        v.setContentsMargins(12, 8, 12, 8)

        # 타이틀 + 저장 위치
        hdr = QLabel("KAPT  통합 데이터 수집기")
        hdr.setFont(QFont("맑은 고딕", 15, QFont.Weight.Bold))
        hdr.setStyleSheet("color:#6eb0f5; padding:2px 0;")
        v.addWidget(hdr)
        self.lbl_outdir = QLabel(f"저장 위치:  {OUTPUT_DIR}")
        self.lbl_outdir.setStyleSheet("color:#394a6a; font-size:9px;")
        v.addWidget(self.lbl_outdir)

        # 중간 행: API 게이지 + 진행 현황
        mid = QHBoxLayout()
        mid.setSpacing(10)
        v.addLayout(mid)

        # ── 좌: API 게이지 3종
        api_gb = self._groupbox("API  사용 현황  (일일 기준)")
        api_v  = QVBoxLayout(api_gb)
        api_v.setSpacing(8)
        self.g_list  = ApiGauge("① 아파트 목록 API  (AptListService3)",        LIST_LIMIT)
        self.g_bass  = ApiGauge("② 단지기본정보 API  (AptBasisInfoServiceV4)", BASS_LIMIT)
        self.g_kakao = ApiGauge("③ 카카오 지오코더")
        api_v.addWidget(self.g_list)
        api_v.addWidget(self.g_bass)
        api_v.addWidget(self.g_kakao)
        mid.addWidget(api_gb, 4)

        # ── 우: 진행 현황 + 버튼
        prog_gb = self._groupbox("수집 진행 현황")
        prog_v  = QVBoxLayout(prog_gb)
        prog_v.setSpacing(6)

        # Phase 배지
        self.lbl_phase = QLabel("대기 중")
        self.lbl_phase.setFont(QFont("맑은 고딕", 12, QFont.Weight.Bold))
        self.lbl_phase.setStyleSheet(
            "color:#4c7cf3; background:#1a2040;"
            "border-radius:6px; padding:4px 10px;")
        prog_v.addWidget(self.lbl_phase)

        self.lbl_total = QLabel("—")
        self.lbl_total.setStyleSheet("color:#4a5a78; font-size:10px;")
        prog_v.addWidget(self.lbl_total)

        # 상단 프로그레스 (파일/지역 단위)
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

        # 하단 프로그레스 (단지 단위)
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
        self.btn_p1   = self._btn("Phase1", "#1864ab", "#1451a0")
        self.btn_p2   = self._btn("Phase2", "#5f3dc4", "#4c309e")
        self.btn_p3   = self._btn("Phase3", "#2b8a3e", "#236e31")
        self.btn_r2   = self._btn("R2 업로드", "#862e9c", "#6d2580")
        for b in (self.btn_p1, self.btn_p2, self.btn_p3, self.btn_r2):
            b.setFixedHeight(32)
            step_row.addWidget(b)
        prog_v.addLayout(step_row)

        # 일괄 버튼
        bulk_row = QHBoxLayout()
        bulk_row.setSpacing(4)
        self.btn_p123  = self._btn("▶  Phase1+2+3", "#2b5ce6", "#1a45c0")
        self.btn_all   = self._btn("▶  전체실행", "#0b7285", "#09636e")
        self.btn_stop  = self._btn("■  중지", "#c92a2a", "#a61e1e")
        self.btn_stop.setEnabled(False)
        bulk_row.addWidget(self.btn_p123)
        bulk_row.addWidget(self.btn_all)
        bulk_row.addWidget(self.btn_stop)
        prog_v.addLayout(bulk_row)

        self.btn_p1.clicked.connect(lambda: self._on_start(1, 1))
        self.btn_p2.clicked.connect(lambda: self._on_start(2, 2))
        self.btn_p3.clicked.connect(lambda: self._on_start(3, 3))
        self.btn_r2.clicked.connect(lambda: self._on_start(4, 4))
        self.btn_p123.clicked.connect(lambda: self._on_start(1, 3))
        self.btn_all.clicked.connect(lambda: self._on_start(1, 4))
        self.btn_stop.clicked.connect(self._on_stop)
        mid.addWidget(prog_gb, 5)

        # 로그
        log_gb = self._groupbox("실시간 로그")
        log_v  = QVBoxLayout(log_gb)
        self.log = QTextEdit()
        self.log.setReadOnly(True)
        self.log.setFont(QFont("Consolas", 9))
        self.log.setStyleSheet(
            "QTextEdit{background:#0c1020;color:#b0c0d8;"
            "border:none;border-radius:4px;padding:4px;}"
        )
        log_v.addWidget(self.log)
        v.addWidget(log_gb, 1)

    # ── 헬퍼 ─────────────────────────────────────────────────────
    def _groupbox(self, title: str) -> QGroupBox:
        gb = QGroupBox(title)
        gb.setStyleSheet("""
            QGroupBox {
                color:#3d4e6a; font-size:10px; font-weight:bold;
                border:1px solid #1e2538; border-radius:8px;
                margin-top:8px; padding-top:10px; background:#161b2e;
            }
            QGroupBox::title { subcontrol-origin:margin; left:10px; padding:0 4px; }
        """)
        return gb

    def _pbar(self, color: str, h: int) -> QProgressBar:
        b = QProgressBar()
        b.setFixedHeight(h)
        r = h // 2
        b.setStyleSheet(
            f"QProgressBar{{background:#1e2538;border-radius:{r}px;"
            f"text-align:center;color:#3d4e6a;font-size:9px;}}"
            f"QProgressBar::chunk{{background:{color};border-radius:{r}px;}}"
        )
        return b

    def _sep(self) -> QFrame:
        s = QFrame()
        s.setFrameShape(QFrame.Shape.HLine)
        s.setStyleSheet("color:#1e2538;max-height:1px;")
        return s

    def _btn(self, text: str, bg: str, hover: str) -> QPushButton:
        b = QPushButton(text)
        b.setFont(QFont("맑은 고딕", 10, QFont.Weight.Bold))
        b.setFixedHeight(38)
        b.setCursor(Qt.CursorShape.PointingHandCursor)
        b.setStyleSheet(
            f"QPushButton{{background:{bg};color:white;border-radius:6px;}}"
            f"QPushButton:hover{{background:{hover};}}"
            f"QPushButton:disabled{{background:#1e2538;color:#333;}}"
        )
        return b

    # ── 지역 목록 로드 ────────────────────────────────────────────
    def _load_regions(self):
        try:
            self.regions = load_regions()
            n = len(self.regions)
            self.bar1.setMaximum(n)
            self.lbl_total.setText(f"총 {n}개 지역")
            self._log(f"✅ 법정동코드 로드 완료  —  {n}개 지역", "ok")
            self._log(f"   법정동코드 파일: {LAW_CODE}", "info")
            self._log(f"   출력 폴더:       {OUTPUT_DIR}", "info")
            self._log("   시작 버튼을 눌러 수집을 시작하세요.", "info")
        except Exception as e:
            self._log(f"❌ 법정동코드 파일 오류: {e}", "warn")
            logger.error(f"법정동코드 로드 실패: {e}\n{traceback.format_exc()}")

    # ── 버튼 이벤트 ───────────────────────────────────────────────
    def _set_btns_enabled(self, enabled: bool):
        for b in (self.btn_p1, self.btn_p2, self.btn_p3, self.btn_r2,
                  self.btn_p123, self.btn_all):
            b.setEnabled(enabled)
        self.btn_stop.setEnabled(not enabled)

    def _on_start(self, start_phase: int = 1, end_phase: int = 4):
        if not self.regions and start_phase < 4:
            return
        self._set_btns_enabled(False)
        labels = {1:"Phase1", 2:"Phase2", 3:"Phase3", 4:"R2업로드"}
        rng = " → ".join(labels[p] for p in range(start_phase, end_phase + 1))
        self._log(f"▶  {rng} 시작", "ok")
        self.worker = CollectorWorker(self.regions, start_phase, end_phase)
        self.worker.s_log.connect(self._log)
        self.worker.s_r2log.connect(self._log)
        self.worker.s_phase.connect(self._on_phase)
        self.worker.s_prog1.connect(self._on_prog1)
        self.worker.s_prog2.connect(self._on_prog2)
        self.worker.s_api.connect(self._on_api)
        self.worker.s_done.connect(self._on_done)
        self.worker.start()

    def _on_stop(self):
        if self.worker:
            self.worker.stop()
        self.btn_stop.setEnabled(False)
        self._log("⛔ 중지 요청  —  현재 작업 완료 후 중단됩니다.", "warn")

    # ── 워커 시그널 핸들러 ────────────────────────────────────────
    def _log(self, msg: str, level: str = "info"):
        color    = LEVEL_COLOR.get(level, "#c0cfe8")
        stripped = msg.lstrip(" ")
        indent   = len(msg) - len(stripped)
        safe     = "&nbsp;" * indent + html.escape(stripped)
        self.log.moveCursor(QTextCursor.MoveOperation.End)
        self.log.insertHtml(f'<span style="color:{color};">{safe}</span><br>')
        self.log.moveCursor(QTextCursor.MoveOperation.End)
        # 파일 로그
        log_level = logging.WARNING if level == "warn" else logging.DEBUG
        logger.log(log_level, msg.strip())

    def _on_phase(self, num: int, title: str):
        color = PHASE_COLOR[num] if num < len(PHASE_COLOR) else "#6eb0f5"
        self.lbl_phase.setText(title)
        self.lbl_phase.setStyleSheet(
            f"color:{color}; background:#1a2040;"
            "border-radius:6px; padding:4px 10px; font-weight:bold; font-size:12px;")
        phase_hints = {
            1: "지역별 아파트 목록 수집 중",
            2: "단지별 기본정보 API 호출 중",
            3: "주소 → 카카오 좌표 변환 중",
            4: "Cloudflare R2 업로드 중",
        }
        self.lbl_p2_hd.setText(phase_hints.get(num, "—"))
        # 하단 바 색상 업데이트
        bar2_colors = {1: "#4c7cf3", 2: "#f59f00", 3: "#40c057", 4: "#cc5de8"}
        c = bar2_colors.get(num, "#4c7cf3")
        h = 12
        self.bar2.setStyleSheet(
            f"QProgressBar{{background:#1e2538;border-radius:6px;}}"
            f"QProgressBar::chunk{{background:{c};border-radius:6px;}}"
        )

    def _on_prog1(self, cur: int, total: int, label: str):
        self.bar1.setMaximum(max(total, 1))
        self.bar1.setValue(cur)
        self.lbl_p1_name.setText(label)
        pct = cur / total * 100 if total else 0
        self.lbl_p1_pct.setText(f"{cur} / {total}  ({pct:.1f}%)")

    def _on_prog2(self, cur: int, total: int):
        self.bar2.setMaximum(max(total, 1))
        self.bar2.setValue(cur)
        pct = cur / total * 100 if total else 0
        self.lbl_p2_pct.setText(f"{cur} / {total}  ({pct:.1f}%)")

    def _on_api(self, nl: int, nb: int, nk: int):
        self.g_list.set_value(nl)
        self.g_bass.set_value(nb)
        self.g_kakao.set_value(nk)

    def _on_done(self, summary: str):
        self._log(f"🎉  {summary}", "ok")
        logger.info(f"수집 완료: {summary}")
        self.lbl_phase.setText("완료 ✅")
        self.lbl_phase.setStyleSheet(
            "color:#69db7c; background:#1a2040;"
            "border-radius:6px; padding:4px 10px; font-weight:bold; font-size:12px;")
        self._set_btns_enabled(True)
        self.worker = None

    def closeEvent(self, event):
        if self.worker and self.worker.isRunning():
            logger.warning("수집 중 창 강제 종료 — 사용자가 창을 닫음")
            self.worker.stop()
        else:
            logger.info("프로그램 정상 종료")
        event.accept()


# ══════════════════════════════════════════════════════════════════
#  진입점
# ══════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    win = MainWindow()
    win.show()
    sys.exit(app.exec())
