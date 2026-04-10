# -*- coding: utf-8 -*-
# finance_data_updater.py
# yfinance + 업비트 API + 한국은행 ECOS API → 주간 종가 CSV 생성
# 생성 파일: finance_{TICKER}_index.json + finance_{TICKER}_{YEAR}.csv
# R2 폴더: /finance/

import os, glob, re, json, logging, sys, time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
import requests
import pandas as pd
import yfinance as yf

# ────────────────────────────────────────────
# 설정
# ────────────────────────────────────────────
ECOS_API_KEY = "550HDNJYC1PARN8WQLDR"   # 한국은행 ECOS API 키
FRED_API_KEY = "090afc86298ebca8d11069b5045eed48"  # FRED API 키

BASE_DIR = Path(__file__).parent / "finance_data"
BASE_DIR.mkdir(exist_ok=True)

LOG_DIR = Path(__file__).parent / "logs"

R2_ACCESS_KEY = "71e270652969acf7a661d46404a196c6"
R2_SECRET_KEY = "e0bdd25cd87d66f24a08e7d98387196fa2316bec40d8fe3b0426aa308fa609d4"
R2_ENDPOINT   = "https://485ad5b19488023956187106c5f363d2.r2.cloudflarestorage.com"
R2_BUCKET     = "apt-chart-data"
R2_FOLDER     = "finance_data"

# yfinance ticker 목록
YFINANCE_TICKERS = {
    "KOSPI":  "^KS11",
    "NASDAQ": "^IXIC",
    "SP500":  "^GSPC",
    "DOW":    "^DJI",
    "GOLD":   "GC=F",
}

# 업비트 마켓 목록
UPBIT_MARKETS = {
    "BTC": "KRW-BTC",
    "ETH": "KRW-ETH",
}

# ────────────────────────────────────────────
# 유틸: 주간 종가 (매 주 마지막 거래일) 추출
# ────────────────────────────────────────────
def to_weekly(df: pd.DataFrame, date_col: str, close_col: str) -> pd.DataFrame:
    """일별 데이터 → 주간 마지막 거래일 종가"""
    df = df[[date_col, close_col]].copy()
    df[date_col] = pd.to_datetime(df[date_col])
    df = df.sort_values(date_col)
    df["week"] = df[date_col].dt.to_period("W")
    weekly = df.groupby("week").last().reset_index()
    weekly = weekly[[date_col, close_col]].rename(columns={date_col: "date", close_col: "close"})
    weekly["date"] = weekly["date"].dt.strftime("%Y-%m-%d")
    return weekly


# ────────────────────────────────────────────
# CSV 연도별 저장 + index.json 생성
# (기존 Rdata 방식과 동일한 구조)
# ────────────────────────────────────────────
def update_year_csvs(ticker: str, df_new: pd.DataFrame):
    """
    df_new 컬럼: date(YYYY-MM-DD), close_krw, close_usd
    """
    df_new = df_new.copy()
    df_new["year"] = pd.to_datetime(df_new["date"]).dt.year

    base_prefix = BASE_DIR / f"finance_{ticker}"
    years = sorted(df_new["year"].unique())
    written_years = []

    for year in years:
        if year <= 0:
            continue
        out_csv = f"{base_prefix}_{year}.csv"
        new_y = df_new[df_new["year"] == year].copy()
        target_dates = set(new_y["date"].astype(str))

        if os.path.exists(out_csv):
            try:
                old = pd.read_csv(out_csv, dtype=str)
            except Exception:
                old = pd.DataFrame()

            if not old.empty:
                old = old[~old["date"].isin(target_dates)]
            else:
                old = pd.DataFrame()

            merged = pd.concat([old, new_y], ignore_index=True)
        else:
            merged = new_y

        merged.drop(columns=["year"], errors="ignore", inplace=True)
        merged["date"] = pd.to_datetime(merged["date"])
        merged = merged.sort_values("date", ascending=False)
        merged["date"] = merged["date"].dt.strftime("%Y-%m-%d")
        merged.to_csv(out_csv, index=False, encoding="utf-8-sig")
        written_years.append(int(year))
        print(f"  저장: {out_csv} ({len(merged)}행)")

    # index.json
    existing_years = []
    for fp in glob.glob(str(base_prefix) + "_[0-9][0-9][0-9][0-9].csv"):
        m = re.search(r"_(\d{4})\.csv$", fp)
        if m:
            existing_years.append(int(m.group(1)))

    all_years = sorted(set(existing_years) | set(written_years))
    latest_date = str(df_new["date"].max()) if not df_new.empty else None

    idx_path = f"{base_prefix}_index.json"
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump({"years": all_years, "latest_date": latest_date}, f, ensure_ascii=False)
    print(f"  index.json 저장: {idx_path}")


# ────────────────────────────────────────────
# 시작 날짜 계산 (기존 CSV 기준 2주 전부터 재수집)
# ────────────────────────────────────────────
def get_start_date(ticker, default_start="2015-01-01"):
    base_prefix = BASE_DIR / f"finance_{ticker}"
    files = glob.glob(str(base_prefix) + "_[0-9][0-9][0-9][0-9].csv")
    
    if not files:
        return default_start  # 파일 없으면 과거부터
    
    # 파일 있으면 → 가장 오래된 날짜와 default_start 중 더 과거를 시작점으로
    oldest_date = None
    for fp in files:
        try:
            df = pd.read_csv(fp, dtype=str)
            if df.empty or "date" not in df.columns:
                continue
            dates = pd.to_datetime(df["date"], errors="coerce").dropna()
            if dates.empty:
                continue
            mn = dates.min()
            if oldest_date is None or mn < oldest_date:
                oldest_date = mn
        except Exception:
            continue
    
    if oldest_date is None:
        return default_start
    
    # 더 과거인 쪽을 시작점으로
    if pd.Timestamp(default_start) < oldest_date:
        return default_start  # 과거 데이터 추가 수집
    else:
        # 기존 데이터가 이미 더 오래됨 → 최신에서 2주 전부터
        latest_date = max(
            pd.to_datetime(pd.read_csv(fp, dtype=str)["date"], errors="coerce").max()
            for fp in files
        )
        start = latest_date - timedelta(weeks=2)
        return start.strftime("%Y-%m-%d")


# ────────────────────────────────────────────
# 환율 조회 (한국은행 ECOS API)
# ────────────────────────────────────────────
def fetch_usd_krw_from_ecos(start_date: str, end_date: str) -> pd.DataFrame:
    """
    한국은행 ECOS API → 일별 USD/KRW 환율 DataFrame (페이지네이션)
    반환: date, usd_krw
    """
    print("환율 조회 (한국은행 ECOS)...")
    s = start_date.replace("-", "")
    e = end_date.replace("-", "")
    all_rows = []
    chunk = 1000
    start_idx = 1

    try:
        while True:
            url = (
                f"https://ecos.bok.or.kr/api/StatisticSearch/{ECOS_API_KEY}/json/kr"
                f"/{start_idx}/{start_idx + chunk - 1}/731Y001/D/{s}/{e}/0000001"
            )
            res = requests.get(url, timeout=15)
            data = res.json()
            rows = data.get("StatisticSearch", {}).get("row", [])
            if not rows:
                break
            all_rows.extend(rows)
            print(f"  환율 수집 중... {len(all_rows)}건")
            if len(rows) < chunk:
                break
            start_idx += chunk
            time.sleep(0.3)

        if not all_rows:
            print("  ECOS 환율 데이터 없음")
            return pd.DataFrame()

        df = pd.DataFrame(all_rows)
        df = df[["TIME", "DATA_VALUE"]].rename(columns={"TIME": "date", "DATA_VALUE": "usd_krw"})
        df["date"] = pd.to_datetime(df["date"], format="%Y%m%d", errors="coerce")
        df["usd_krw"] = pd.to_numeric(df["usd_krw"], errors="coerce")
        df = df.dropna().sort_values("date")
        print(f"  환율 총 {len(df)}일치 수집 완료")
        return df
    except Exception as e:
        print(f"  ECOS API 오류: {e}")
        return pd.DataFrame()


def save_usdkrw_csv(fx_df: pd.DataFrame):
    """일별 환율 데이터 → 주간 종가 CSV 저장 (USDKRW 티커)"""
    if fx_df.empty:
        print("  환율 데이터 없음, CSV 저장 생략")
        return

    df = fx_df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")
    df["week"] = df["date"].dt.to_period("W")
    weekly = df.groupby("week").last().reset_index()
    weekly = weekly[["date", "usd_krw"]].copy()
    weekly["close_krw"] = weekly["usd_krw"].round(2)   # KRW per 1 USD
    weekly["close_usd"] = 1.0                           # 기준 단위: 1 USD
    weekly["date"] = weekly["date"].dt.strftime("%Y-%m-%d")
    weekly = weekly[["date", "close_krw", "close_usd"]]

    print(f"\n[USDKRW] 환율 CSV 저장...")
    update_year_csvs("USDKRW", weekly)


# ────────────────────────────────────────────
# 기준금리 수집 (한국은행 ECOS API — 월별 → 주간 forward-fill)
# ────────────────────────────────────────────
def fetch_ecos_rate(ticker: str, stat_code: str, item_code: str, start_date: str, end_date: str):
    print(f"\n[{ticker}] 기준금리 수집 (ECOS {stat_code}/{item_code})...")
    s = start_date.replace("-", "")[:6]  # YYYYMM
    e = end_date.replace("-", "")[:6]
    all_rows = []
    chunk = 1000
    start_idx = 1

    try:
        while True:
            url = (
                f"https://ecos.bok.or.kr/api/StatisticSearch/{ECOS_API_KEY}/json/kr"
                f"/{start_idx}/{start_idx + chunk - 1}/{stat_code}/M/{s}/{e}/{item_code}"
            )
            res = requests.get(url, timeout=15)
            data = res.json()
            rows = data.get("StatisticSearch", {}).get("row", [])
            if not rows:
                break
            all_rows.extend(rows)
            if len(rows) < chunk:
                break
            start_idx += chunk
            time.sleep(0.3)

        if not all_rows:
            print(f"  {ticker} 데이터 없음")
            return

        df = pd.DataFrame(all_rows)
        df = df[["TIME", "DATA_VALUE"]].rename(columns={"TIME": "ym", "DATA_VALUE": "rate"})
        df["date"] = pd.to_datetime(df["ym"], format="%Y%m", errors="coerce")
        df["rate"] = pd.to_numeric(df["rate"], errors="coerce")
        df = df.dropna(subset=["date", "rate"]).sort_values("date")
        print(f"  월별 {len(df)}건 수집")

        # 월별 → 일별 forward-fill → 주간 마지막 거래일
        daily = pd.date_range(df["date"].min(), pd.Timestamp(end_date), freq="D")
        rate_series = df.set_index("date")["rate"].reindex(daily).ffill()
        rate_df = rate_series.reset_index().rename(columns={"index": "date", 0: "rate"})
        rate_df["week"] = rate_df["date"].dt.to_period("W")
        weekly = rate_df.groupby("week").last().reset_index()
        weekly["close_krw"] = weekly["rate"].round(4)
        weekly["close_usd"] = weekly["rate"].round(4)  # 금리는 통화 구분 없이 동일값
        weekly["date"] = weekly["date"].dt.strftime("%Y-%m-%d")
        weekly = weekly[["date", "close_krw", "close_usd"]]

        print(f"  주간 {len(weekly)}건 변환")
        update_year_csvs(ticker, weekly)

    except Exception as ex:
        print(f"  오류: {ex}")


def fetch_ecos_market_rate(ticker: str, item_code: str, start_date: str, end_date: str):
    """817Y002 시장금리(일별) → 주간 마지막 거래일 CSV"""
    print(f"\n[{ticker}] 시장금리 수집 (817Y002/{item_code})...")
    s = start_date.replace("-", "")  # YYYYMMDD
    e = end_date.replace("-", "")
    all_rows = []
    chunk = 1000
    start_idx = 1

    try:
        while True:
            url = (
                f"https://ecos.bok.or.kr/api/StatisticSearch/{ECOS_API_KEY}/json/kr"
                f"/{start_idx}/{start_idx + chunk - 1}/817Y002/D/{s}/{e}/{item_code}"
            )
            res = requests.get(url, timeout=15)
            data = res.json()
            rows = data.get("StatisticSearch", {}).get("row", [])
            if not rows:
                break
            all_rows.extend(rows)
            if len(rows) < chunk:
                break
            start_idx += chunk
            time.sleep(0.3)

        if not all_rows:
            print(f"  {ticker} 데이터 없음")
            return

        df = pd.DataFrame(all_rows)
        df = df[["TIME", "DATA_VALUE"]].rename(columns={"TIME": "date", "DATA_VALUE": "rate"})
        df["date"] = pd.to_datetime(df["date"], format="%Y%m%d", errors="coerce")
        df["rate"] = pd.to_numeric(df["rate"], errors="coerce")
        df = df.dropna(subset=["date", "rate"]).sort_values("date")
        print(f"  일별 {len(df)}건 수집")

        df["week"] = df["date"].dt.to_period("W")
        weekly = df.groupby("week").last().reset_index()
        weekly["close_krw"] = weekly["rate"].round(4)
        weekly["close_usd"] = weekly["rate"].round(4)
        weekly["date"] = weekly["date"].dt.strftime("%Y-%m-%d")
        weekly = weekly[["date", "close_krw", "close_usd"]]

        print(f"  주간 {len(weekly)}건 변환")
        update_year_csvs(ticker, weekly)

    except Exception as ex:
        print(f"  오류: {ex}")


def fetch_fred_rate(ticker: str, series_id: str, start_date: str, end_date: str):
    """FRED API (일별) → 주간 마지막 거래일 CSV"""
    print(f"\n[{ticker}] FRED 수집 ({series_id})...")
    url = (
        f"https://api.stlouisfed.org/fred/series/observations"
        f"?series_id={series_id}&api_key={FRED_API_KEY}&file_type=json"
        f"&observation_start={start_date}&observation_end={end_date}"
    )
    try:
        res = requests.get(url, timeout=15)
        data = res.json()
        observations = data.get("observations", [])
        if not observations:
            print(f"  {ticker} 데이터 없음")
            return

        df = pd.DataFrame(observations)[["date", "value"]].copy()
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["rate"] = pd.to_numeric(df["value"], errors="coerce")
        df = df.dropna(subset=["date", "rate"]).sort_values("date")
        print(f"  일별 {len(df)}건 수집")

        df["week"] = df["date"].dt.to_period("W")
        weekly = df.groupby("week").last().reset_index()
        weekly["close_krw"] = weekly["rate"].round(4)
        weekly["close_usd"] = weekly["rate"].round(4)
        weekly["date"] = weekly["date"].dt.strftime("%Y-%m-%d")
        weekly = weekly[["date", "close_krw", "close_usd"]]

        print(f"  주간 {len(weekly)}건 변환")
        update_year_csvs(ticker, weekly)

    except Exception as ex:
        print(f"  오류: {ex}")


def get_exchange_rate(date_series: pd.Series, fx_df: pd.DataFrame) -> pd.Series:
    """날짜별 환율 매핑 (없으면 가장 가까운 이전 날짜 값 사용)"""
    if fx_df.empty:
        return pd.Series([1300.0] * len(date_series), index=date_series.index)
    fx = fx_df.set_index("date")["usd_krw"]
    rates = []
    for d in pd.to_datetime(date_series):
        past = fx[fx.index <= d]
        rates.append(float(past.iloc[-1]) if not past.empty else 1300.0)
    return pd.Series(rates, index=date_series.index)


# ────────────────────────────────────────────
# yfinance 수집 (KOSPI, NASDAQ, SP500, DOW, GOLD)
# ────────────────────────────────────────────
def fetch_yfinance(ticker_name: str, yf_symbol: str, start_date: str, fx_df: pd.DataFrame):
    print(f"\n[{ticker_name}] yfinance 수집 ({yf_symbol})...")
    try:
        end_date = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        raw = yf.download(yf_symbol, start=start_date, end=end_date, auto_adjust=True, progress=False)
        if raw.empty:
            print(f"  데이터 없음")
            return

        raw = raw.reset_index()

        # 컬럼명 정규화 (MultiIndex 대응)
        raw.columns = [c[0] if isinstance(c, tuple) else c for c in raw.columns]
        raw = raw.rename(columns={"Date": "date", "Close": "close"})
        raw["date"] = pd.to_datetime(raw["date"])

        weekly = to_weekly(raw, "date", "close")
        print(f"  주간 {len(weekly)}건 수집")

        # KOSPI는 원화 지수라 USD 변환 불필요
        if ticker_name == "KOSPI":
            weekly["close_krw"] = weekly["close"].round(2)
            weekly["close_usd"] = weekly["close"].round(2)  # 지수값 그대로
        else:
            # USD 기준 → KRW 환산
            rates = get_exchange_rate(weekly["date"], fx_df)
            weekly["close_usd"] = weekly["close"].round(4)
            weekly["close_krw"] = (weekly["close"] * rates.values).round(0)

        weekly = weekly[["date", "close_krw", "close_usd"]]
        update_year_csvs(ticker_name, weekly)

    except Exception as e:
        print(f"  오류: {e}")


# ────────────────────────────────────────────
# 업비트 수집 (BTC, ETH)
# ────────────────────────────────────────────
def fetch_upbit(ticker_name: str, market: str, start_date: str, fx_df: pd.DataFrame):
    print(f"\n[{ticker_name}] 업비트 수집 ({market})...")
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    all_rows = []
    to_dt = datetime.now()

    while True:
        to_str = to_dt.strftime("%Y-%m-%dT%H:%M:%S")
        url = f"https://api.upbit.com/v1/candles/days"
        params = {"market": market, "count": 200, "to": to_str}
        try:
            res = requests.get(url, params=params, timeout=10)
            data = res.json()
        except Exception as e:
            print(f"  요청 오류: {e}")
            break

        if not data or not isinstance(data, list):
            break

        for row in data:
            all_rows.append({
                "date": row["candle_date_time_kst"][:10],
                "close_krw": float(row["trade_price"]),
            })

        oldest = datetime.strptime(data[-1]["candle_date_time_kst"][:10], "%Y-%m-%d")
        if oldest <= start_dt or len(data) < 200:
            break

        to_dt = oldest - timedelta(days=1)
        time.sleep(0.13)

    if not all_rows:
        print("  데이터 없음")
        return

    df = pd.DataFrame(all_rows)
    df["date"] = pd.to_datetime(df["date"])
    df = df[df["date"] >= pd.Timestamp(start_date)]
    df = df.sort_values("date")

    # 주간 종가
    df["week"] = df["date"].dt.to_period("W")
    weekly = df.groupby("week").last().reset_index()
    weekly = weekly[["date", "close_krw"]].copy()

    # KRW → USD 환산
    rates = get_exchange_rate(weekly["date"], fx_df)
    weekly["close_usd"] = (weekly["close_krw"] / rates.values).round(2)
    weekly["date"] = weekly["date"].dt.strftime("%Y-%m-%d")

    print(f"  주간 {len(weekly)}건 수집")
    update_year_csvs(ticker_name, weekly)


# ────────────────────────────────────────────
# 메인 실행
# ────────────────────────────────────────────
def run():
    print("=" * 50)
    print(f"금융 데이터 수집 시작: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 50)

    today = datetime.now().strftime("%Y-%m-%d")

    # 1. 환율 수집 — 기존 CSV가 있으면 읽어서 재사용, 최신분만 추가 fetch
    ECOS_EARLIEST = "1964-01-01"
    existing_csvs = sorted(glob.glob(str(BASE_DIR / "finance_USDKRW_[0-9][0-9][0-9][0-9].csv")))
    if existing_csvs:
        old_frames = []
        for fp in existing_csvs:
            try:
                df_tmp = pd.read_csv(fp, dtype=str)
                if not df_tmp.empty and "date" in df_tmp.columns:
                    old_frames.append(df_tmp)
            except Exception:
                pass
        if old_frames:
            old_fx = pd.concat(old_frames, ignore_index=True)
            old_fx["date"] = pd.to_datetime(old_fx["date"], errors="coerce")
            old_fx["usd_krw"] = pd.to_numeric(old_fx["close_krw"], errors="coerce")
            old_fx = old_fx[["date", "usd_krw"]].dropna().sort_values("date")
            # 최신 날짜 이후분만 ECOS에서 추가 수집
            latest = old_fx["date"].max()
            fetch_start = (latest - timedelta(weeks=2)).strftime("%Y-%m-%d")
            print(f"환율 CSV 발견 — {fetch_start} 이후분만 추가 수집...")
            new_fx = fetch_usd_krw_from_ecos(fetch_start, today)
            if not new_fx.empty:
                fx_df = pd.concat([old_fx, new_fx], ignore_index=True)
                fx_df = fx_df.drop_duplicates(subset=["date"]).sort_values("date")
            else:
                fx_df = old_fx
        else:
            fx_df = fetch_usd_krw_from_ecos(ECOS_EARLIEST, today)
    else:
        print("환율 CSV 없음 — 전체 수집...")
        fx_df = fetch_usd_krw_from_ecos(ECOS_EARLIEST, today)
    save_usdkrw_csv(fx_df)
    time.sleep(0.5)

    # 2. 기준금리 + 시장금리 수집
    ktb5y_start = get_start_date("KTB5Y", "2000-01-04")
    fetch_ecos_market_rate("KTB5Y", "010200001", ktb5y_start, today)
    time.sleep(0.5)

    kr_start = get_start_date("KR_RATE", "1999-05-01")
    fetch_ecos_rate("KR_RATE", "722Y001", "0101000", kr_start, today)
    time.sleep(0.5)

    us_start = get_start_date("US_RATE", "1954-07-01")  # FRED DFF 최초 데이터
    fetch_fred_rate("US_RATE", "DFF", us_start, today)
    time.sleep(0.5)

    # 3. yfinance 수집
    for ticker_name, yf_symbol in YFINANCE_TICKERS.items():
        # yfinance 자산별 최대 시작일로 변경
        default_starts = {
            "KOSPI":  "1980-01-01",
            "NASDAQ": "1971-01-01",
            "SP500":  "1927-01-01",
            "DOW":    "1985-01-01",
            "GOLD":   "1974-01-01",
        }
        start = get_start_date(ticker_name, default_starts.get(ticker_name, "2015-01-01"))
        fetch_yfinance(ticker_name, yf_symbol, start, fx_df)
        time.sleep(0.5)

    # 4. 업비트 수집
    for ticker_name, market in UPBIT_MARKETS.items():
        start = get_start_date(ticker_name, "2018-01-01")  # 업비트 데이터 시작
        fetch_upbit(ticker_name, market, start, fx_df)
        time.sleep(0.5)

    print("\n" + "=" * 50)
    print(f"전체 완료: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"저장 위치: {BASE_DIR}")
    print("=" * 50)
    print("\nR2 업로드: R2업로드 버튼을 눌러 finance_data/ 폴더를 R2에 업로드하세요.")


# ════════════════════════════════════════════════════════════════
#  PyQt6 GUI
# ════════════════════════════════════════════════════════════════
from PyQt6.QtWidgets import (
    QApplication, QFrame, QHBoxLayout, QLabel,
    QMainWindow, QPushButton,
    QTextEdit, QVBoxLayout, QWidget,
)
from PyQt6.QtCore import QThread, pyqtSignal
from PyQt6.QtGui import QTextCursor

# ── 다크 테마 색상 ──
C = {
    "bg":       "#0f1117",
    "panel":    "#1a1d27",
    "border":   "#2a2d3a",
    "accent":   "#4f8ef7",
    "ok":       "#3ec97a",
    "warn":     "#f5a623",
    "error":    "#f05e5e",
    "skip":     "#5a6080",
    "header":   "#c5ceff",
    "text":     "#d0d5f0",
    "dim":      "#6b7094",
    "gauge_bg": "#1e2235",
}

LOG_COLORS = {
    "info":   C["text"],
    "ok":     C["ok"],
    "warn":   C["warn"],
    "error":  C["error"],
    "skip":   C["skip"],
    "header": C["header"],
}


def _setup_logger() -> logging.Logger:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_path = LOG_DIR / f"finance_{ts}.log"
    logger = logging.getLogger(f"finance_{ts}")
    logger.setLevel(logging.DEBUG)
    fh = logging.FileHandler(log_path, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(fh)
    return logger


class _StdoutCatcher:
    """print() 출력을 Qt 시그널로 리디렉션"""
    def __init__(self, callback):
        self._cb = callback

    def write(self, text):
        if text.strip():
            self._cb(text.rstrip(), "info")

    def flush(self):
        pass


class CollectorWorker(QThread):
    sig_log      = pyqtSignal(str, str)   # (message, level)
    sig_finished = pyqtSignal(str)        # 완료 메시지

    def __init__(self, start_step: int, end_step: int):
        super().__init__()
        self.start_step = start_step   # 1=수집, 2=R2업로드
        self.end_step   = end_step
        self._stop = False
        self._logger = _setup_logger()

    def stop(self):
        self._stop = True

    def _log(self, msg: str, level: str = "info"):
        self.sig_log.emit(msg, level)
        self._logger.info(f"[{level}] {msg}")

    def _step1(self):
        """금융 데이터 수집 (기존 run() 함수 실행, stdout 캡처)"""
        self._log("═" * 50, "header")
        self._log("  📈 금융 데이터 수집 시작", "header")
        self._log("═" * 50, "header")

        old_stdout = sys.stdout
        sys.stdout = _StdoutCatcher(self._log)
        try:
            run()
        except Exception as e:
            self._log(f"  ❌ 수집 오류: {e}", "error")
            self._logger.exception("step1 error")
        finally:
            sys.stdout = old_stdout

    def _step2(self):
        """finance_data/*.csv + *.json → R2 gzip 업로드 (변경된 파일만)"""
        self._log("═" * 50, "header")
        self._log("  ☁ R2 업로드 시작 (변경된 파일만)", "header")
        self._log("═" * 50, "header")

        s3 = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY,
            aws_secret_access_key=R2_SECRET_KEY,
        )

        files = list(BASE_DIR.glob("*.csv")) + list(BASE_DIR.glob("*.json"))
        self._log(f"  📂 {R2_FOLDER}: {len(files)}개 파일 확인 중...", "info")
        uploaded = skipped = errors = 0

        for local_path in files:
            if self._stop:
                break

            ext = local_path.suffix
            r2_key = f"{R2_FOLDER}/{local_path.name}"

            r2_mtime = None
            try:
                head = s3.head_object(Bucket=R2_BUCKET, Key=r2_key)
                r2_mtime = head["LastModified"].replace(tzinfo=timezone.utc).timestamp()
            except ClientError as e:
                if e.response["Error"]["Code"] not in ("404", "NoSuchKey"):
                    self._log(f"  ⚠ head_object 오류 {local_path.name}: {e}", "warn")

            local_mtime = local_path.stat().st_mtime
            if r2_mtime is not None and local_mtime <= r2_mtime:
                self._log(f"  ⏭ skip (변경 없음): {local_path.name}", "skip")
                skipped += 1
                continue

            try:
                with open(local_path, "rb") as f_in:
                    raw = f_in.read()

                body = raw
                ct = "text/csv" if ext == ".csv" else "application/json"

                s3.put_object(Bucket=R2_BUCKET, Key=r2_key, Body=body, ContentType=ct)

                self._log(f"  ✅ 업로드: {r2_key}  ({len(body):,} bytes)", "ok")
                self._logger.info(f"uploaded {r2_key} ({len(body)} bytes)")
                uploaded += 1
            except Exception as e:
                self._log(f"  ❌ 업로드 실패 {local_path.name}: {e}", "error")
                self._logger.error(f"upload failed {local_path.name}: {e}")
                errors += 1

        self._log(
            f"\n  R2 업로드 완료 — 업로드: {uploaded}개 / 스킵: {skipped}개 / 오류: {errors}개", "ok"
        )

    def run(self):
        if self.start_step <= 1 <= self.end_step:
            self._step1()

        if not self._stop and self.start_step <= 2 <= self.end_step:
            self._step2()

        if self._stop:
            self.sig_finished.emit("중단됨")
        else:
            self.sig_finished.emit("완료 ✅")


# ── 로그 위젯 ──
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
            }}
        """)

    def append_colored(self, text: str, level: str = "info"):
        color = LOG_COLORS.get(level, C["text"])
        cursor = self.textCursor()
        cursor.movePosition(QTextCursor.MoveOperation.End)
        self.setTextCursor(cursor)
        self.insertHtml(
            f'<span style="color:{color};">'
            f'{text.replace("<","&lt;").replace(">","&gt;").replace(chr(10),"<br>")}'
            f'</span><br>'
        )
        self.verticalScrollBar().setValue(self.verticalScrollBar().maximum())


# ── 메인 윈도우 ──
class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("📈 금융 데이터 수집기")
        self.setMinimumSize(800, 600)
        self.resize(900, 680)
        self._worker: CollectorWorker | None = None
        self._apply_style()
        self._build_ui()

    def _apply_style(self):
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
            QPushButton#btn_collect {{
                background: {C['accent']};
                color: white;
                border: none;
            }}
            QPushButton#btn_collect:hover {{ background: #6fa8ff; }}
            QPushButton#btn_r2 {{
                background: {C['ok']};
                color: white;
                border: none;
            }}
            QPushButton#btn_r2:hover {{ background: #5de08f; }}
            QPushButton#btn_all {{
                background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                    stop:0 {C['accent']}, stop:1 {C['ok']});
                color: white;
                border: none;
            }}
            QPushButton#btn_all:hover {{ opacity:0.85; }}
            QPushButton#btn_stop {{
                background: {C['error']}22;
                color: {C['error']};
                border: 1px solid {C['error']}66;
            }}
            QPushButton#btn_stop:hover {{ background: {C['error']}44; }}
            QPushButton:disabled {{ opacity: 0.4; }}
            QLabel {{ color: {C['text']}; }}
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

    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QVBoxLayout(central)
        root.setContentsMargins(18, 14, 18, 14)
        root.setSpacing(12)

        # 헤더
        header = QHBoxLayout()
        title = QLabel("📈  금융 데이터 수집기")
        title.setStyleSheet(f"font-size:18px; font-weight:800; color:{C['header']};")
        sub = QLabel("yfinance · 업비트 · 한국은행 ECOS · FRED → 주간 종가 CSV")
        sub.setStyleSheet(f"font-size:11px; color:{C['dim']}; margin-top:3px;")
        th = QVBoxLayout()
        th.addWidget(title)
        th.addWidget(sub)
        header.addLayout(th)
        root.addLayout(header)

        # 구분선
        line = QFrame()
        line.setFrameShape(QFrame.Shape.HLine)
        line.setStyleSheet(f"border:none; border-top:1px solid {C['border']};")
        root.addWidget(line)

        # 버튼 영역
        btn_row = QHBoxLayout()
        btn_row.setSpacing(10)
        self.btn_collect = QPushButton("▶  수집")
        self.btn_r2      = QPushButton("☁  R2업로드")
        self.btn_all     = QPushButton("▶  전체실행 (수집+R2)")
        self.btn_stop    = QPushButton("⏹  중지")
        self.btn_collect.setObjectName("btn_collect")
        self.btn_r2.setObjectName("btn_r2")
        self.btn_all.setObjectName("btn_all")
        self.btn_stop.setObjectName("btn_stop")
        self.btn_collect.clicked.connect(lambda: self._start(1, 1))
        self.btn_r2.clicked.connect(lambda: self._start(2, 2))
        self.btn_all.clicked.connect(lambda: self._start(1, 2))
        self.btn_stop.clicked.connect(self._stop)
        self.btn_stop.setEnabled(False)
        for b in (self.btn_collect, self.btn_r2, self.btn_all, self.btn_stop):
            btn_row.addWidget(b)
        root.addLayout(btn_row)

        # 로그
        self.log = ColorLog()
        root.addWidget(self.log, 1)

        # 초기 메시지
        self.log.append_colored("금융 데이터 수집기가 준비됐습니다.", "ok")
        self.log.append_colored(f"저장 경로: {BASE_DIR}", "info")
        self.log.append_colored(f"R2 버킷: {R2_BUCKET} / {R2_FOLDER}  (.csv 업로드)", "info")

    def _all_step_btns(self):
        return (self.btn_collect, self.btn_r2, self.btn_all)

    def _start(self, start_step: int, end_step: int):
        labels = {(1,1): "수집", (2,2): "R2 업로드", (1,2): "전체실행 (수집+R2)"}
        self.log.clear()
        self.log.append_colored(
            f"{labels.get((start_step,end_step),'실행')} 시작  "
            f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}]", "header"
        )

        self._worker = CollectorWorker(start_step, end_step)
        self._worker.sig_log.connect(lambda msg, lv: self.log.append_colored(msg, lv))
        self._worker.sig_finished.connect(self._on_finished)
        self._worker.start()

        for b in self._all_step_btns():
            b.setEnabled(False)
        self.btn_stop.setEnabled(True)

    def _stop(self):
        if self._worker:
            self._worker.stop()
        self.log.append_colored("\n⏹ 중지 요청됨...", "warn")

    def _on_finished(self, msg: str):
        self.log.append_colored(f"\n{'='*48}", "header")
        self.log.append_colored(f"  {msg}", "ok" if "완료" in msg else "warn")
        self.log.append_colored(f"{'='*48}", "header")
        for b in self._all_step_btns():
            b.setEnabled(True)
        self.btn_stop.setEnabled(False)

    def closeEvent(self, e):
        if self._worker and self._worker.isRunning():
            self._worker.stop()
            self._worker.wait(3000)
        e.accept()


# ── 진입점 ──
if __name__ == "__main__":
    from PyQt6.QtGui import QColor, QPalette
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
