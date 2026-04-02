import boto3
import os
import datetime
from pathlib import Path
from datetime import timezone

# R2 설정
ACCESS_KEY = "71e270652969acf7a661d46404a196c6"
SECRET_KEY = "e0bdd25cd87d66f24a08e7d98387196fa2316bec40d8fe3b0426aa308fa609d4"
ENDPOINT = "https://485ad5b19488023956187106c5f363d2.r2.cloudflarestorage.com"
BUCKET = "apt-chart-data"

UPLOAD_FOLDERS = [
    r"D:\apt-chart3\public\coordinput",
    r"D:\apt-chart3\public\Rdata",
    r"D:\apt-chart3\public\Pdata",
]

s3 = boto3.client(
    "s3",
    endpoint_url=ENDPOINT,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
)

def should_upload(file_path, folder_name):
    # py 파일 제외
    if file_path.suffix == ".py":
        return False
    # coordinput 폴더는 전부 업로드
    if folder_name == "coordinput":
        return True
    # Rdata, Pdata 폴더는 필터링
    if file_path.name.startswith("Rdata_") or \
       file_path.name.startswith("Pdata_") or \
       file_path.suffix == ".json":
        return True
    return False

# R2에 있는 파일 목록 + 수정시간 가져오기
print("R2 파일 목록 확인 중...")
existing = {}
paginator = s3.get_paginator("list_objects_v2")
for page in paginator.paginate(Bucket=BUCKET):
    for obj in page.get("Contents", []):
        existing[obj["Key"]] = obj["LastModified"]

print(f"R2에 이미 {len(existing)}개 파일 있음")

for folder in UPLOAD_FOLDERS:
    folder_path = Path(folder)
    folder_name = folder_path.name
    files = list(folder_path.rglob("*"))
    total = len([f for f in files if f.is_file()])
    count = 0
    skip = 0
    upload = 0

    for file_path in files:
        if file_path.is_file():
            key = f"{folder_name}/{file_path.relative_to(folder_path)}"
            key = key.replace("\\", "/")
            count += 1

            # 업로드 대상 아니면 건너뜀
            if not should_upload(file_path, folder_name):
                skip += 1
                continue

            # 로컬 파일 수정시간
            local_mtime = file_path.stat().st_mtime
            local_dt = datetime.datetime.fromtimestamp(local_mtime, tz=timezone.utc)

            # R2에 있고 로컬이 더 오래됐으면 건너뜀
            if key in existing and local_dt <= existing[key]:
                skip += 1
                continue

            print(f"[{count}/{total}] 업로드 중: {key}")
            s3.upload_file(str(file_path), BUCKET, key)
            upload += 1

    print(f"{folder_name} 완료! (업로드: {upload}개 / 건너뜀: {skip}개)")

print("전체 완료!")