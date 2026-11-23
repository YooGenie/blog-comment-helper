// 네이버 지도 장소 페이지(pcmap.place.naver.com, m.place.naver.com)에
// "가게 정보 정리" 버튼을 붙입니다. 영업시간·주차 등을 정리해서 복사할 수 있게 합니다.
(() => {
  if (window.__bwsPlaceHelper) return;
  window.__bwsPlaceHelper = true;

  // 장소 상세 페이지에서만 (검색 목록 프레임 제외)
  const isPlacePage = () => /\/(restaurant|place|cafe|hairshop|nailshop|hospital|accommodation|attraction)\/\d+/.test(location.pathname) || /\/place\/\d+/.test(location.pathname);
  if (!isPlacePage()) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const textOf = (el) => (el?.innerText ?? el?.textContent ?? "").trim();

  // 접혀 있는 영업시간을 펼칩니다(화면 펼치기만, 다른 동작 없음).
  async function expandHours() {
    let clicked = false;
    for (const el of document.querySelectorAll("[aria-expanded='false']")) {
      const box = el.closest("div, li, section");
      const t = textOf(box).slice(0, 200);
      if (/영업|운영|시간/.test(t)) {
        el.click();
        clicked = true;
      }
    }
    if (clicked) await wait(600);
  }

  function pageText() {
    const main = document.querySelector("#app-root, main, body") || document.body;
    return textOf(main).replace(/\n{3,}/g, "\n\n").slice(0, 15000);
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
        <strong>가게 정보</strong>
        <button class="bws-x" title="닫기">✕</button>
      </div>
      <textarea class="bws-text" style="min-height:180px" placeholder="여기에 영업시간·주차 정보가 정리돼요. 고쳐 써도 돼요."></textarea>
      <div class="bws-status"></div>
      <div class="bws-btns">
        <button class="bws-regen">다시 정리</button>
        <button class="bws-copy bws-primary">복사</button>
      </div>
      <div class="bws-note">페이지에 있는 정보만 정리해요. 주차가 안 나오면 <b>정보</b> 탭을 열고 다시 정리해 보세요.</div>
    `;
    document.body.appendChild(panel);

    const ta = panel.querySelector(".bws-text");
    const status = panel.querySelector(".bws-status");
    const setStatus = (t, err) => {
      status.textContent = t || "";
      status.classList.toggle("bws-err", !!err);
    };

    async function run() {
      setStatus("페이지를 읽고 정리하는 중…");
      ta.value = "";
      await expandHours();
      const text = pageText();
      if (text.length < 30) return setStatus("페이지 내용을 찾지 못했어요. 새로고침해 보세요.", true);
      const r = await chrome.runtime.sendMessage({ type: "placeInfo", text, url: location.href });
      if (r?.ok) {
        ta.value = r.text;
        setStatus("");
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
      if (!ta.value.trim()) return setStatus("복사할 내용이 없어요.", true);
      await copy(ta.value);
      setStatus("복사했어요. 블로그 글에 붙여 넣으세요.");
    });
  }

  // 페이지가 늦게 그려지는 경우를 위해 잠시 기다립니다.
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
