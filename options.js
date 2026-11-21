const FIELDS = ["apiKey", "model", "tone", "length", "myBlog", "extra", "useImages", "imageCount"];

chrome.storage.local.get(FIELDS).then((s) => {
  for (const f of FIELDS) {
    if (s[f] === undefined) continue;
    const el = document.getElementById(f);
    if (f === "useImages") el.value = s[f] ? "on" : "off";
    else el.value = String(s[f]);
  }
});

// 한국 시간(KST) 0시 기준
const kst = (d) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }); // YYYY-MM-DD
async function renderStats() {
  const { counts = {} } = await chrome.storage.local.get("counts");
  const now = Date.now();
  document.getElementById("today").textContent = counts[kst(new Date(now))] || 0;
  const days = [];
  let total = 0;
  for (let i = 6; i >= 0; i--) {
    const key = kst(new Date(now - i * 86400000));
    const n = counts[key] || 0;
    total += n;
    const [, m, dd] = key.split("-");
    days.push(`${+m}/${+dd} ${n}개`);
  }
  document.getElementById("week").textContent = `최근 7일 (합계 ${total}개): ${days.join(" · ")}`;
}
renderStats();
chrome.storage.onChanged.addListener((ch) => ch.counts && renderStats());

document.getElementById("save").addEventListener("click", async () => {
  const data = {};
  for (const f of FIELDS) data[f] = document.getElementById(f).value.trim();
  data.useImages = data.useImages !== "off";
  data.imageCount = Number(data.imageCount) || 4;
  await chrome.storage.local.set(data);
  const el = document.getElementById("saved");
  el.textContent = "저장했어요 ✓";
  setTimeout(() => (el.textContent = ""), 2000);
});
