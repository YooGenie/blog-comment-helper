// 툴바 아이콘을 누르면 설정 페이지를 엽니다.
chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

const DEFAULTS = {
  apiKey: "",
  model: "gemini-3.1-flash-lite",
  tone: "친근한 존댓말",
  length: "2~3문장",
  myBlog: "",
  extra: "",
  backupModel: "",
  myBlogId: "",
  useImages: false,
  imageCount: 4
};

// 네이버 사진 서버가 외부 요청을 막지 않도록, 이 확장이 사진을 받을 때만 Referer를 네이버로 붙입니다.
async function setupRefererRule() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [{ header: "Referer", operation: "set", value: "https://blog.naver.com/" }]
        },
        condition: {
          urlFilter: "||pstatic.net/",
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ["xmlhttprequest", "other"]
        }
      }]
    });
  } catch (e) {
    console.warn("Referer rule failed", e);
  }
}
chrome.runtime.onInstalled.addListener(setupRefererRule);
chrome.runtime.onStartup.addListener(setupRefererRule);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "generate") {
    generate(msg).then(
      (r) => sendResponse({ ok: true, ...r }),
      (err) => sendResponse({ ok: false, error: String(err.message || err) })
    );
    return true; // 비동기 응답
  }
  if (msg.type === "placeInfo") {
    placeInfo(msg).then(
      (r) => sendResponse({ ok: true, ...r }),
      (err) => sendResponse({ ok: false, error: String(err.message || err) })
    );
    return true;
  }
  if (msg.type === "openOptions") {
    chrome.runtime.openOptionsPage();
  }
});

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

// 사진을 받아서 Gemini에 넣을 수 있는 형태로 바꿉니다. 실패한 사진은 건너뜁니다.
async function loadImages(urls, max) {
  const out = [];
  for (const url of urls) {
    if (out.length >= max) break;
    try {
      const res = await fetch(url, { credentials: "omit" });
      if (!res.ok) continue;
      let type = (res.headers.get("content-type") || "").split(";")[0].trim();
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) {
        if (/\.(jpe?g)(\?|$)/i.test(url)) type = "image/jpeg";
        else if (/\.png(\?|$)/i.test(url)) type = "image/png";
        else continue; // gif 등은 건너뜀
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 3000 || buf.byteLength > 4 * 1024 * 1024) continue;
      out.push({ inlineData: { mimeType: type, data: toBase64(buf) } });
    } catch {
      /* 건너뜀 */
    }
  }
  return out;
}

// Gemini 호출 공통 함수: 서버가 바쁘면 자동 재시도, 예비 모델로 한 번 더 시도
async function callGemini(s, system, parts, temperature = 0.8) {
  let model = (s.model || DEFAULTS.model).trim();
  if (!model.startsWith("gemini")) model = DEFAULTS.model;
  const reqBody = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: { maxOutputTokens: 2048, temperature }
  });

  const backup = (s.backupModel || "").trim();
  const models = [model, ...(backup.startsWith("gemini") && backup !== model ? [backup] : [])];
  const waits = [0, 1500, 4000]; // 모델마다 최대 3번
  let res, data, lastStatus, lastMsg;
  outer: for (const m of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
    for (const w of waits) {
      if (w) await new Promise((r) => setTimeout(r, w));
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": s.apiKey },
          body: reqBody
        });
      } catch (e) {
        lastStatus = 0;
        lastMsg = "인터넷 연결을 확인해 주세요.";
        continue;
      }
      data = await res.json().catch(() => ({}));
      if (res.ok) break outer;
      lastStatus = res.status;
      lastMsg = data?.error?.message || res.statusText;
      if (![500, 503, 504].includes(res.status)) break outer; // 재시도해도 안 되는 오류
    }
  }

  if (!res?.ok) {
    if (lastStatus === 429) throw new Error("무료 사용 한도에 걸렸어요. 1분 정도 기다렸다가 다시 눌러 주세요.");
    if ([500, 503, 504].includes(lastStatus)) throw new Error("Google AI 서버가 지금 바빠요. 몇 번 다시 시도했는데 안 됐어요. 잠시 후 다시 눌러 주세요.");
    if (lastStatus === 0) throw new Error(lastMsg);
    throw new Error(`AI 호출 실패 (${lastStatus}): ${lastMsg}`);
  }
  const out = data?.candidates?.[0]?.content?.parts || [];
  return out.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
}

const stripEmoji = (t) => t.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu, "");

// ---- 네이버 지도 장소 정보 정리 ----
async function placeInfo({ text = "", url = "" }) {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  if (!s.apiKey) throw new Error("API 키가 없어요. 툴바의 확장 아이콘을 눌러 설정에서 넣어 주세요.");
  const system = [
    "너는 네이버 지도 장소 페이지의 텍스트에서 블로그 글에 넣을 가게 정보를 정리한다.",
    "반드시 페이지 텍스트에 있는 정보만 쓴다. 없는 정보는 추측하지 말고 그 줄을 아예 빼라.",
    "아래 형식으로, 순서대로, 있는 항목만 쓴다:",
    "가게 이름",
    "- 주소: (도로명 주소)",
    "- 영업시간: 요일별로 정리. 매일 같으면 '매일 11:00 ~ 21:00'처럼 한 줄로. 요일마다 다르면 '월~금 11:00 ~ 21:00 / 토·일 10:00 ~ 20:00'처럼 묶는다.",
    "- 브레이크타임: (있을 때만)",
    "- 라스트오더: (있을 때만)",
    "- 휴무: (정기 휴무일이 있을 때만)",
    "- 주차: 가능/불가, 주차장 위치, 무료 시간이나 요금, 발렛 등 페이지에 있는 내용을 한 줄로.",
    "- 전화: (있을 때만)",
    "- 예약: (예약 가능 여부가 있을 때만)",
    "'오늘 휴무', '영업 중', '곧 영업 종료' 같은 지금 상태 문구는 쓰지 않는다.",
    "리뷰, 메뉴, 가격, 광고 문구는 넣지 않는다.",
    "이모지, 마크다운 굵게(**) 기호는 쓰지 않는다.",
    "출력은 정리한 내용만. 설명이나 인사 없이."
  ].join("\n");
  const out = await callGemini(s, system, [{ text: `페이지 주소: ${url}\n\n페이지 텍스트:\n${text.slice(0, 15000)}` }], 0.2);
  if (!out) throw new Error("빈 응답이 왔어요. 다시 시도해 주세요.");
  return { text: stripEmoji(out).replace(/\*\*/g, "").replace(/[ \t]+$/gm, "").trim() };
}

// 댓글·답글 공통: 사람 말투 규칙
const STYLE_RULES = [
  "이모지는 절대 쓰지 않는다. (ㅎㅎ, ㅠㅠ, ㅋㅋ 같은 한글 표현은 가끔 자연스럽게 써도 된다)",
  "AI가 쓴 티가 나지 않게, 실제 사람이 폰으로 툭 남기는 말처럼 쓴다:",
  "- 글이나 댓글을 요약하거나 정리하지 말고, 눈에 띈 한두 가지에 대한 내 반응만 말한다.",
  "- '~지만 ~네요', '~고 ~해서 ~해 보여요'처럼 장점·단점을 균형 맞춰 늘어놓는 문장 구조를 피한다.",
  "- '정말', '너무', '꼭', '완벽', '인상적', '매력적', '유익한', '생생한', '잘 보고 갑니다', '좋은 글 감사합니다' 같은 상투어를 남발하지 않는다.",
  "- 문장 끝을 모두 '~네요!', '~요!'로 똑같이 맞추지 말고, 느낌표는 많아야 1개.",
  "- 문장 길이를 들쭉날쭉하게, 약간 구어체로. 완벽하게 다듬어진 문장보다 자연스러운 말투가 낫다.",
  "AI 특유의 과장된 표현을 쓰지 않는다:",
  "- '단순한 ~가 아닌', '~을 넘어', '특별한 경험', '좋은 선택', '소중한 시간', '~라는 점이 인상적' 같은 상투적인 표현은 자연스럽게 바꿔 쓴다.",
  "- 추상적인 칭찬이나 과도한 감정 표현은 줄인다.",
  "- 실제 사람이 잘 쓰지 않는 거창한 표현 대신 쉽고 일상적인 단어를 쓴다."
];

function buildCommentPrompt(s) {
  return [
    "너는 네이버 블로그 이웃의 글에 댓글을 다는 블로거를 돕는다.",
    "글을 실제로 읽은 사람처럼, 본문 속 구체적인 내용(장소, 메뉴, 장면, 느낀 점 등) 1~2가지를 짚어서 댓글을 쓴다.",
    `말투: ${s.tone}. 길이: ${s.length}.`,
    "규칙: 링크·홍보·'서이추'·'맞방' 같은 요청 금지. 직접 가 본 척, 먹어 본 척 등 사실이 아닌 경험을 지어내지 않는다.",
    ...STYLE_RULES,
    s.myBlog ? `댓글 쓰는 사람 소개(관련 있을 때만 자연스럽게 반영): ${s.myBlog}` : "",
    s.extra ? `추가 요청: ${s.extra}` : "",
    "사진이 함께 오면 사진 속 음식·장소·분위기 중 눈에 띄는 것을 자연스럽게 언급해도 된다. 단, 사진에서 확실히 보이는 것만 말하고 추측해서 지어내지 않는다.",
    "출력은 댓글 본문만. 따옴표나 설명 없이."
  ].filter(Boolean).join("\n");
}

function buildReplyPrompt(s) {
  return [
    "너는 네이버 블로그 주인이다. 내 글에 이웃이 남긴 댓글에 답글을 쓴다.",
    "댓글에서 상대가 한 말(질문, 감상, 경험)에 직접 반응한다. 질문이 있으면 내 글 내용 안에서 짧게 답한다. 글에 없는 정보(가격, 영업시간 등)는 지어내지 말고 모른다고 하거나 넘어간다.",
    "고마움은 표현해도 되지만 '방문해 주셔서 감사합니다', '소중한 댓글 감사합니다' 같은 틀에 박힌 인사만으로 끝내지 않는다.",
    "닉네임이 있으면 가끔 'OO님'으로 불러도 된다. 매번 이름으로 시작하지는 않는다.",
    `말투: ${s.tone}. 길이: 1~2문장, 댓글보다 길지 않게.`,
    "규칙: 링크·홍보·'서이추'·'맞방' 요청 금지. 약속(다음에 꼭 가겠다 등)을 지어내지 않는다.",
    ...STYLE_RULES,
    s.myBlog ? `블로그 주인 소개(관련 있을 때만 자연스럽게 반영): ${s.myBlog}` : "",
    s.extra ? `추가 요청: ${s.extra}` : "",
    "출력은 답글 본문만. 따옴표나 설명 없이."
  ].filter(Boolean).join("\n");
}

async function generate({ mode = "comment", title, body, images = [], comment = "", nick = "" }) {
  const s = { ...DEFAULTS, ...(await chrome.storage.local.get(Object.keys(DEFAULTS))) };
  if (!s.apiKey) throw new Error("API 키가 없어요. 툴바의 확장 아이콘을 눌러 설정에서 넣어 주세요.");

  const isReply = mode === "reply";
  const system = isReply ? buildReplyPrompt(s) : buildCommentPrompt(s);
  const userText = isReply
    ? `내 글 제목: ${title || "(제목 없음)"}\n\n내 글 본문(참고용):\n${(body || "").slice(0, 6000)}\n\n댓글 쓴 사람: ${nick || "(알 수 없음)"}\n댓글 내용:\n${comment}`
    : `제목: ${title || "(제목 없음)"}\n\n본문:\n${body}`;
  if (isReply) images = [];

  const maxImgs = Math.max(0, Math.min(6, Number(s.imageCount) || 0));
  const imageParts = s.useImages && maxImgs ? await loadImages(images, maxImgs) : [];
  const parts = [
    { text: userText },
    ...(imageParts.length ? [{ text: `글에 들어 있는 사진 ${imageParts.length}장:` }, ...imageParts] : [])
  ];
  let text = await callGemini(s, system, parts, 0.8);
  if (!text) throw new Error("빈 응답이 왔어요. 다시 시도해 주세요.");
  // 혹시 남은 이모지는 지웁니다.
  text = text.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]/gu, "").replace(/[ \t]{2,}/g, " ").replace(/^["'“”]+|["'“”]+$/g, "").trim();
  return { text, imageCount: imageParts.length };
}
