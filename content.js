// 네이버 블로그 글 화면에 "댓글 초안" 버튼을 붙입니다.
// 이 확장은 댓글칸에 글자만 넣습니다. 등록 버튼은 절대 누르지 않습니다.
(() => {
  if (window.__bwsCommentHelper) return;
  window.__bwsCommentHelper = true;

  const BODY_SELECTORS = [".se-main-container", "#postViewArea", ".se_component_wrap", "#viewTypeSelector"];
  const TITLE_SELECTORS = [".se-title-text", ".se_title", ".pcol1", ".htitle", "h3.tit_h3"];
  const COMMENT_INPUT_SELECTORS = [
    ".u_cbox_write_box .u_cbox_text[contenteditable='true']",
    ".u_cbox_write_box textarea.u_cbox_text",
    ".u_cbox_text[contenteditable='true']",
    "textarea.u_cbox_text",
    ".u_cbox_inbox textarea"
  ];
  const COMMENT_OPEN_SELECTORS = ["a.btn_comment", "a._cmtList", ".area_comment a", "[class*='btn_comment']"];

  const $ = (sels, root = document) => {
    for (const s of sels) {
      const el = root.querySelector(s);
      if (el) return el;
    }
    return null;
  };

  // 본문이 늦게 뜨는 경우를 위해 잠시 기다립니다.
  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if ($(BODY_SELECTORS)) {
      clearInterval(timer);
      mount();
    } else if (tries > 20) {
      clearInterval(timer);
    }
  }, 500);

  function getPost() {
    const bodyEl = $(BODY_SELECTORS);
    const titleEl = $(TITLE_SELECTORS);
    const body = (bodyEl?.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
    const title = (titleEl?.innerText || document.title || "").trim();
    return { title, body, images: getImageUrls(bodyEl) };
  }

  // 본문 속 사진 주소를 모읍니다(스티커·아이콘 제외). 고르게 최대 6장 후보.
  function getImageUrls(bodyEl) {
    if (!bodyEl) return [];
    const urls = [];
    for (const img of bodyEl.querySelectorAll("img")) {
      if (img.closest(".se-sticker, .se-oglink, .se-map, .se-video, .se-placesMap")) continue;
      let src = img.getAttribute("data-lazy-src") || img.currentSrc || img.src || "";
      if (!/^https:\/\/[^/]*pstatic\.net\//.test(src)) continue;
      if (/sticker|storep-phinf|dthumb/.test(src)) continue;
      if (img.naturalWidth && img.naturalWidth < 150) continue;
      // 흐린 미리보기(w80_blur) 대신 보통 크기로
      src = src.replace(/type=w\d+_blur/, "type=w773");
      if (!/[?&]type=/.test(src)) src += (src.includes("?") ? "&" : "?") + "type=w773";
      if (!urls.includes(src)) urls.push(src);
    }
    const max = 6;
    if (urls.length <= max) return urls;
    const step = urls.length / max;
    return Array.from({ length: max }, (_, i) => urls[Math.floor(i * step)]);
  }

  // ---- 오늘 댓글 수 세기 ----
  // 도우미 창의 "복사" 버튼을 누를 때 1개로 셉니다.
  // 같은 글에서 여러 번 복사해도 하루 1개만 셉니다. 한국 시간(KST) 0시에 초기화.
  const todayKey = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
  const postKey = () => {
    const u = new URL(location.href);
    const id = u.searchParams.get("blogId");
    const no = u.searchParams.get("logNo");
    if (id && no) return `${id}/${no}`;
    const m = u.pathname.match(/^\/([^/]+)\/(\d+)/);
    return m ? `${m[1]}/${m[2]}` : u.pathname;
  };
  async function getTodayCount() {
    const { counts = {} } = await chrome.storage.local.get("counts");
    return counts[todayKey()] || 0;
  }
  async function addCount() {
    const { counts = {}, done = {} } = await chrome.storage.local.get(["counts", "done"]);
    const k = todayKey();
    const list = done[k] || [];
    const pk = postKey();
    if (list.includes(pk)) return { n: counts[k] || 0, added: false };
    list.push(pk);
    counts[k] = (counts[k] || 0) + 1;
    // 오늘 것만 남기고, 횟수는 최근 60일만 보관
    const newDone = { [k]: list };
    for (const key of Object.keys(counts).sort().slice(0, -60)) delete counts[key];
    await chrome.storage.local.set({ counts, done: newDone });
    return { n: counts[k], added: true };
  }

  function mount() {
    const fab = document.createElement("button");
    fab.className = "bws-fab";
    document.body.appendChild(fab);

    const panel = document.createElement("div");
    panel.className = "bws-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="bws-head">
        <strong>댓글 초안 <span class="bws-count">· 오늘 0개</span></strong>
        <button class="bws-x" title="닫기">✕</button>
      </div>
      <textarea class="bws-text" placeholder="여기에 댓글 초안이 나와요. 고쳐 써도 돼요."></textarea>
      <div class="bws-status"></div>
      <div class="bws-btns">
        <button class="bws-regen">다시 쓰기</button>
        <button class="bws-copy">복사</button>
        <button class="bws-fill bws-primary">댓글칸에 넣기</button>
      </div>
      <div class="bws-note">넣은 뒤 내용 확인하고 <b>등록은 직접</b> 눌러 주세요.</div>
    `;
    document.body.appendChild(panel);

    const countEl = panel.querySelector(".bws-count");
    const render = (n) => {
      fab.textContent = `💬 댓글 초안 · 오늘 ${n}개`;
      countEl.textContent = `· 오늘 ${n}개`;
    };
    getTodayCount().then(render);
    chrome.storage.onChanged.addListener((ch) => {
      if (ch.counts) getTodayCount().then(render);
    });

    const ta = panel.querySelector(".bws-text");
    const status = panel.querySelector(".bws-status");
    const setStatus = (t, err) => {
      status.textContent = t || "";
      status.classList.toggle("bws-err", !!err);
    };

    async function run() {
      const post = getPost();
      if (post.body.length < 20 && !post.images.length) {
        setStatus("본문을 찾지 못했어요. 페이지를 새로고침해 보세요.", true);
        return;
      }
      setStatus(post.images.length ? "글과 사진을 읽고 댓글을 쓰는 중…" : "글을 읽고 댓글을 쓰는 중…");
      ta.value = "";
      const r = await chrome.runtime.sendMessage({ type: "generate", ...post });
      if (r?.ok) {
        ta.value = r.text;
        setStatus(r.imageCount ? `사진 ${r.imageCount}장도 함께 봤어요.` : "");
      } else {
        setStatus(r?.error || "알 수 없는 오류", true);
      }
    }

    fab.addEventListener("click", () => {
      panel.hidden = false;
      if (!ta.value) run();
    });
    panel.querySelector(".bws-x").addEventListener("click", () => (panel.hidden = true));
    panel.querySelector(".bws-regen").addEventListener("click", run);
    panel.querySelector(".bws-copy").addEventListener("click", async () => {
      if (!ta.value.trim()) return setStatus("복사할 댓글이 없어요.", true);
      await copy(ta.value);
      const r = await addCount();
      render(r.n);
      setStatus(r.added ? `복사했어요. 오늘 ${r.n}번째 댓글이에요!` : "복사했어요. (이 글은 오늘 이미 세었어요)");
    });
    panel.querySelector(".bws-fill").addEventListener("click", async () => {
      const text = ta.value.trim();
      if (!text) return setStatus("넣을 댓글이 없어요.", true);
      const ok = await fillComment(text);
      if (ok) {
        setStatus("댓글칸에 넣었어요. 확인 후 등록을 직접 눌러 주세요.");
      } else {
        await copy(text);
        setStatus("댓글칸을 못 찾았어요. 대신 복사했으니 붙여 넣어 주세요.", true);
      }
    });
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function findCommentInput() {
    let el = $(COMMENT_INPUT_SELECTORS);
    if (el) return el;
    // 댓글 영역이 접혀 있으면 펼치기만 합니다(등록과 무관).
    const opener = $(COMMENT_OPEN_SELECTORS);
    if (opener) {
      opener.click();
      for (let i = 0; i < 10 && !el; i++) {
        await wait(400);
        el = $(COMMENT_INPUT_SELECTORS);
      }
    }
    return el;
  }

  async function fillComment(text) {
    const el = await findCommentInput();
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    // 안내 문구(placeholder 라벨)가 있으면 클릭해서 입력 상태로 만듭니다.
    el.closest(".u_cbox_write_box")?.querySelector(".u_cbox_guide")?.click();
    el.focus();

    if (el.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("selectAll", false, null);
      const ok = document.execCommand("insertText", false, text);
      if (!ok || !el.innerText.trim()) {
        el.innerText = text;
        el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
    }
    return true;
  }
})();
