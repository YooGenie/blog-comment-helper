// 네이버 지도 장소 페이지(pcmap.place.naver.com, m.place.naver.com)에 버튼을 붙입니다.
// [가게 정보] 영업시간·주차 등 정리  [리뷰 요약] 방문자 리뷰 요약  [블로그 제목] 블로그 리뷰 제목·링크 목록
// 페이지의 탭을 눌러 화면을 바꾸는 것 말고는 아무것도 누르지 않습니다.
(() => {
  if (window.__bwsPlaceHelper) return;
  window.__bwsPlaceHelper = true;

  const isPlacePage = () => /\/(restaurant|place|cafe|hairshop|nailshop|hospital|accommodation|attraction)\/\d+/.test(location.pathname);
  if (!isPlacePage()) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (el) => (el?.innerText ?? el?.textContent ?? "").trim();

  // 페이지 안의 탭(홈·정보·리뷰·블로그 리뷰 등)을 이름으로 찾아 누릅니다.
  async function openTab(re) {
    const cands = [...document.querySelectorAll("[role='tab'], a, button")].filter((el) => {
      const t = textOf(el).replace(/\s+/g, " ");
      return t.length <= 20 && re.test(t);
    });
    const tab = cands.find((el) => el.getAttribute("role") === "tab") || cands[0];
    if (!tab) return false;
    if (tab.getAttribute("aria-selected") !== "true") {
      tab.click();
      await wait(1500);
    }
    return true;
  }

  // 접혀 있는 영업시간을 펼칩니다.
  async function expandHours() {
    let clicked = false;
    for (const el of document.querySelectorAll("[aria-expanded='false']")) {
      const box = el.closest("div, li, section");
      if (/영업|운영|시간/.test(textOf(box).slice(0, 200))) {
        el.click();
        clicked = true;
      }
    }
    if (clicked) await wait(600);
  }

  const pageText = () => textOf(document.querySelector("#app-root") || document.body).replace(/\n{3,}/g, "\n\n").slice(0, 15000);

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

  // ---- 각 기능 ----
  async function doInfo(setStatus) {
    await openTab(/^홈$/);
    await expandHours();
    let text = pageText();
    // 주차 정보는 "정보" 탭에 더 자세히 있어서 함께 읽습니다.
    if (await openTab(/^정보$/)) text += "\n\n[정보 탭]\n" + pageText();
    setStatus("정리하는 중…");
    return chrome.runtime.sendMessage({ type: "placeInfo", text, url: location.href });
  }

  async function doReviews(setStatus) {
    await openTab(/^리뷰(\s*[\d,]+)?$/);
    await openTab(/^방문자\s*리뷰(\s*[\d,]+)?$/);
    const text = pageText();
    if (!/리뷰/.test(text)) return { ok: false, error: "리뷰를 찾지 못했어요. 가게의 리뷰 탭을 열고 다시 눌러 주세요." };
    setStatus("리뷰를 요약하는 중…");
    return chrome.runtime.sendMessage({ type: "reviewSummary", text, url: location.href });
  }

  async function doBlogs(setStatus) {
    await openTab(/^리뷰(\s*[\d,]+)?$/);
    await openTab(/^블로그(\s*리뷰)?(\s*[\d,]+)?$/);
    const seen = new Set();
    const items = [];
    for (const a of document.querySelectorAll("a[href*='blog.naver.com']")) {
      const url = a.href.split("#")[0];
      const m = url.match(/blog\.naver\.com\/(?:PostView\.naver\?blogId=)?([^/?&]+)(?:\/|&logNo=)(\d+)/);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ url: `https://blog.naver.com/${key}`, text: textOf(a) || textOf(a.closest("li")) });
    }
    if (!items.length) return { ok: false, error: "블로그 리뷰를 찾지 못했어요. 리뷰 탭의 '블로그 리뷰'를 열고 다시 눌러 주세요." };
    setStatus(`블로그 글 ${items.length}개에서 제목을 뽑는 중…`);
    const r = await chrome.runtime.sendMessage({ type: "blogTitles", items });
    if (!r?.ok) return r;
    const lines = [];
    items.forEach((it, i) => {
      const t = r.titles[i];
      if (t) lines.push(`${lines.length + 1}) ${t}`);
    });
    if (!lines.length) return { ok: false, error: "제목을 뽑지 못했어요. 다시 눌러 주세요." };
    return { ok: true, text: `블로그 리뷰 제목\n${lines.join("\n")}` };
  }

  const MODES = {
    info: { label: "가게 정보", run: doInfo, note: "페이지에 있는 정보만 정리해요." },
    reviews: { label: "리뷰 요약", run: doReviews, note: "리뷰 문장을 그대로 옮기지 않고 요약해요." },
    blogs: { label: "블로그 제목", run: doBlogs, note: "지금 화면에 보이는 블로그 리뷰만 가져와요. 더 보려면 목록을 내린 뒤 다시 눌러 주세요." }
  };

  function mount() {
    if (document.querySelector(".bws-fab")) return;
    const fab = document.createElement("button");
    fab.className = "bws-fab";
    fab.textContent = "📋 가게 정보 정리";
    document.body.appendChild(fab);

    const panel = document.createElement("div");
    panel.className = "bws-panel";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="bws-head">
        <strong>가게 정보 정리</strong>
        <button class="bws-x" title="닫기">✕</button>
      </div>
      <div class="bws-tabs">
        <button data-mode="info">가게 정보</button>
        <button data-mode="reviews">리뷰 요약</button>
        <button data-mode="blogs">블로그 제목</button>
      </div>
      <textarea class="bws-text" style="min-height:180px" placeholder="위 버튼을 누르면 여기에 정리돼요. 고쳐 써도 돼요."></textarea>
      <div class="bws-status"></div>
      <div class="bws-btns">
        <button class="bws-regen">다시 정리</button>
        <button class="bws-copy bws-primary">복사</button>
      </div>
      <div class="bws-note"></div>
    `;
    document.body.appendChild(panel);

    const ta = panel.querySelector(".bws-text");
    const status = panel.querySelector(".bws-status");
    const note = panel.querySelector(".bws-note");
    const setStatus = (t, err) => {
      status.textContent = t || "";
      status.classList.toggle("bws-err", !!err);
    };
    let mode = "info";
    let busy = false;

    async function run(m = mode) {
      if (busy) return;
      busy = true;
      mode = m;
      panel.querySelectorAll(".bws-tabs button").forEach((b) => b.classList.toggle("bws-on", b.dataset.mode === mode));
      note.textContent = MODES[mode].note;
      ta.value = "";
      setStatus("페이지를 읽는 중…");
      try {
        const r = await MODES[mode].run(setStatus);
        if (r?.ok) {
          ta.value = r.text;
          setStatus("");
        } else {
          setStatus(r?.error || "알 수 없는 오류", true);
        }
      } catch (e) {
        setStatus(String(e.message || e), true);
      } finally {
        busy = false;
      }
    }

    fab.addEventListener("click", () => {
      panel.hidden = false;
      if (!ta.value) run("info");
    });
    panel.querySelectorAll(".bws-tabs button").forEach((b) => b.addEventListener("click", () => run(b.dataset.mode)));
    panel.querySelector(".bws-x").addEventListener("click", () => (panel.hidden = true));
    panel.querySelector(".bws-regen").addEventListener("click", () => run());
    panel.querySelector(".bws-copy").addEventListener("click", async () => {
      if (!ta.value.trim()) return setStatus("복사할 내용이 없어요.", true);
      await copy(ta.value);
      setStatus("복사했어요. 블로그 글에 붙여 넣으세요.");
    });
  }

  let tries = 0;
  const timer = setInterval(() => {
    tries++;
    if (document.body && textOf(document.body).length > 50) {
      clearInterval(timer);
      mount();
    } else if (tries > 20) {
      clearInterval(timer);
    }
  }, 500);
})();
