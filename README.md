# ECLIPSE Guild Manager v19 — Google Sheets 원본 연동

v16의 ECLIPSE UI를 기준으로, **길드원 목록의 원본을 Google Forms가 연결된 Google Sheets로 변경**한 버전입니다.

## 핵심 구조

```text
Google Form
   ↓
Google Sheets (사용자가 주신 시트)
   ↓  ← 필요할 때 상단의 "시트 동기화" 버튼으로 갱신
ECLIPSE Next.js API
   ↓
Supabase members
   ↓
ECLIPSE 길드원 목록
```

사이트를 열면 Supabase에 저장된 데이터를 빠르게 표시합니다. Google Sheets의 최신 내용을 반영하려면 상단의 **시트 동기화** 버튼을 누르세요. 자동 폴링과 Supabase Realtime 구독은 사용량 폭증을 막기 위해 비활성화되어 있습니다.

사용 시트:
- Spreadsheet ID: `10TUvN2-5otNh22h8ABDT3bzek6anbUxeJhjodvBfQzE`
- GID: `314429358`

## 중요한 설정 — Google Sheet 공개 읽기

Vercel 서버가 로그인 없이 Google Sheet를 읽어야 하므로 해당 시트를 **웹에 게시**해야 합니다.

Google Sheets에서:
1. **파일 → 공유 → 웹에 게시**
2. 현재 사용 중인 시트 탭 선택
3. 형식은 **CSV**로 선택
4. **게시**

또는 조직/개인 계정의 공유 정책상 가능하다면 링크가 있는 사용자가 볼 수 있도록 설정합니다.

> 시트가 비공개 상태라면 Vercel 서버가 최신 행을 읽을 수 없습니다. 이 경우 Google Apps Script 방식 대신 Google Cloud 서비스 계정 + Sheets API 방식으로 연결해야 합니다.

## 시트 헤더

사이트가 다음 이름을 자동으로 찾습니다.

- 닉네임: `닉네임` / `이름` / `게임닉네임` / `캐릭터명`
- 직업: `직업` / `클래스`
- 투력: `투력` / `전투력` / `전투력(투력)`
- 메모: `메모` / `비고`

최소한 **닉네임 + 투력** 열은 있어야 합니다.

## Vercel 환경변수

기존 변수:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_ADMIN_PASSWORD=0910
```

추가:

```env
SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_SERVICE_ROLE_KEY`는 절대로 `NEXT_PUBLIC_`을 붙이지 마세요.

선택적으로 다른 시트를 사용할 경우:

```env
GOOGLE_SHEET_ID=...
GOOGLE_SHEET_GID=...
GOOGLE_ATTENDANCE_SHEET_GID=400265627
```

`GOOGLE_ATTENDANCE_SHEET_GID`는 **출석 기록** 탭의 GID입니다. 현재 사용 중인 출석 기록 탭은 `400265627`입니다.

기본값은 위의 ECLIPSE 시트 ID/GID가 들어 있습니다.

## 메모 동작

Google Sheet는 **닉네임 / 직업 / 투력의 원본**입니다.

길드원 카드에서 수정하는 메모는 기존처럼 Supabase에 저장됩니다. 따라서 Google Sheet의 메모 열이 비어 있으면 웹에서 작성한 메모가 자동으로 지워지지 않습니다. Sheet의 메모 칸에 값이 있으면 그 값으로 동기화합니다.

## 기존 Google Apps Script는 필요 없음

이번 v19 방식에서는 Google Form 제출 트리거를 Apps Script에 설치할 필요가 없습니다.

Google Form → Sheet가 정상적으로 업데이트되기만 하면 됩니다.

## Discord 출석

기존 v17/v18의 Discord 봇 연동 구조는 그대로 유지합니다.
`integrations/discord-bot`을 사용하고 Vercel의 `ECLIPSE_INTEGRATION_TOKEN` 환경변수를 사용하는 기존 방식과 함께 사용할 수 있습니다.

## Vercel 배포용 수정사항

배포용 버전에는 다음 안정화가 적용되어 있습니다.
- 관리자 비밀번호를 `NEXT_PUBLIC_ADMIN_PASSWORD` 환경변수에서 읽습니다.
- Google Sheet 동기화와 Realtime 이벤트가 서로 무한 반복되는 문제를 방지했습니다.
- Google Sheets 동기화는 상단의 **시트 동기화** 버튼을 눌렀을 때만 실행됩니다. 일반 새로고침 버튼은 Supabase 데이터만 다시 읽습니다.
- `.gitignore`와 `vercel.json`을 포함했습니다.

자세한 순서는 `DEPLOY_VERCEL.md`를 참고하세요.

## 긴급 모드: 보스 참여 기록 Google Sheets 직접 연동

Free Plan quota 제한으로 Supabase를 사용할 수 없는 경우에도 `보스 참여 기록` 화면을 사용할 수 있도록 `GET /api/google-sheet/boss-records`가 추가되었습니다. 현재 `출석 기록` 탭(GID `400265627`)의 A~F 열을 읽어 보스별로 그룹화하며, Supabase `boss_records`에는 쓰지 않습니다.
