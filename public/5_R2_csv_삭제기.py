"""
R2 버킷의 모든 오브젝트 삭제 스크립트
- 버킷 전체 오브젝트 대상 (파일 형식 무관)
- 삭제 전 목록 출력 후 확인 요청
"""

import boto3

R2_ACCESS_KEY = "71e270652969acf7a661d46404a196c6"
R2_SECRET_KEY = "e0bdd25cd87d66f24a08e7d98387196fa2316bec40d8fe3b0426aa308fa609d4"
R2_ENDPOINT   = "https://485ad5b19488023956187106c5f363d2.r2.cloudflarestorage.com"
R2_BUCKET     = "apt-chart-data"

def main():
    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
    )

    # 버킷 전체 오브젝트 목록 수집
    paginator = s3.get_paginator("list_objects_v2")
    all_keys = []
    for page in paginator.paginate(Bucket=R2_BUCKET):
        for obj in page.get("Contents", []):
            all_keys.append(obj["Key"])

    if not all_keys:
        print("삭제할 오브젝트가 없습니다.")
        return

    print(f"\n삭제 대상 오브젝트: {len(all_keys):,}개")
    print("-" * 60)
    for key in all_keys[:50]:
        print(f"  {key}")
    if len(all_keys) > 50:
        print(f"  ... 외 {len(all_keys) - 50:,}개")
    print("-" * 60)

    answer = input(f"\n위 {len(all_keys):,}개 오브젝트를 모두 삭제하시겠습니까? (yes 입력 시 삭제): ").strip()
    if answer.lower() != "yes":
        print("취소되었습니다.")
        return

    # 1000개씩 배치 삭제
    deleted = 0
    for i in range(0, len(all_keys), 1000):
        batch = [{"Key": k} for k in all_keys[i:i+1000]]
        resp = s3.delete_objects(Bucket=R2_BUCKET, Delete={"Objects": batch})
        deleted += len(resp.get("Deleted", []))
        errors = resp.get("Errors", [])
        if errors:
            for err in errors:
                print(f"  삭제 실패: {err['Key']} - {err['Message']}")

    print(f"\n삭제 완료: {deleted:,}개")

if __name__ == "__main__":
    main()
