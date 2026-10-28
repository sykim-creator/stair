// 이벤트 설정 — 배포 전 이 파일만 수정하면 됩니다.
// (서버가 실제로 검사하는 시간대·기간·최소/최대 시간은 담당자 페이지 > 설정 탭에서 바꿉니다.
//  이 파일의 같은 이름 값은 "데모 모드"에서만 쓰입니다.)
window.CONFIG = {
  EVENT_NAME: '계단오르기 챌린지',
  EVENT_PERIOD: '2026.11.02 ~ 2026.12.31', // 화면 표시용. 실제 운영 기간 확정 후 수정 (서버 설정과 맞출 것)

  // 참가자용 Google Apps Script 웹앱 URL (README 참고). 비워두면 "데모 모드"(브라우저 저장소)로 동작합니다.
  // ※ 이전 팀이 만든 배포 URL은 일부러 비워 두었습니다. 새 스프레드시트·새 배포의 URL을 넣으세요.
  API_URL: 'https://script.google.com/macros/s/AKfycbxFo5VJfX9aMY72qREfvqrS2gTMjVeb5_OS-xQ4vEW2APARyevilI9Tu_UrFXRFu4KG/exec',

  // 담당자(종료 QR 관리) 페이지 URL = 담당자용 Apps Script 웹앱 배포 URL. admin.html / qr.html 이 이 주소로 안내합니다.
  ADMIN_URL: '',

  // ----- 데모 모드 전용 -----
  DEMO_ENTRY_KEY: 'demo',      // 접속 주소 뒤에 ?k=demo
  DEMO_END_KEY: 'demo-end',    // 종료 QR 내용: STAIR-END:demo-end
  DEMO_SKIP_TIME_RULES: false, // true면 데모에서 시간대 제한을 건너뜀(아무 때나 화면 확인). false면 실제와 같이 출근/점심 시간에만 가능
  FLOORS_PER_RUN: 10,          // 1회 완료 = 10개 층 (1~10F)
  MIN_SECONDS: 30,             // 이보다 빨리 종료하면 "의심"으로 표시 (현장 실측 후 조정)
  MAX_SECONDS: 1800,           // 이보다 오래 걸리면 진행 중 기록 만료
  WINDOWS: [
    { id: 'am',    label: '출근', start: '06:00', end: '08:30' },
    { id: 'lunch', label: '점심', start: '11:40', end: '13:00' },
  ],

  // 계열사 목록 (KBI 프로젝트 정렬 순서). 서버(Code.gs)의 DEPARTMENTS 와 동일하게 맞추세요.
  DEPARTMENTS: ['메탈', '코스모', '알로이', '철관', '합섬상사', '건설', '유상테크', '경영전략실'],
};
