const matches = [
  {
    id: 1, source: "Reddit", sourceClass: "reddit", sourceMark: "r/", community: "r/SaaS", time: "12 min ago", level: "High intent", score: 94, saved: false,
    title: "How are small teams handling regression testing before every release?",
    excerpt: "We're only three developers and manually check signup, billing, and onboarding every time we ship...",
    author: "u/bootstrapped_ben · 6 comments",
    body: ["We're only three developers and manually check signup, billing, and onboarding every time we ship. It takes half a day and we still occasionally miss something obvious.", "We tried Playwright, but nobody has time to keep the tests working whenever the UI changes. What are other small teams using?"],
    reasons: ["Small SaaS team", "Explicit manual-testing pain", "Actively asking for solutions", "Problem is happening now"],
    scores: {"Problem fit": 98, "ICP fit": 91, "Buyer intent": 94, "Urgency": 88}
  },
  {
    id: 2, source: "X", sourceClass: "x", sourceMark: "𝕏", community: "@maria_builds", time: "34 min ago", level: "High intent", score: 91, saved: true,
    title: "There has to be a less fragile way to test critical user flows",
    excerpt: "Our E2E suite is red after every frontend change. I want confidence before deploys, not another codebase to maintain.",
    author: "Maria Chen · Founder at Formly",
    body: ["Our E2E suite is red after every frontend change. I want confidence before deploys, not another codebase to maintain.", "Has anyone found a less fragile way to test the 5–6 critical flows that actually matter?"],
    reasons: ["Founder at a SaaS", "Current tool frustration", "Wants fewer maintenance costs", "Asking the market for options"],
    scores: {"Problem fit": 96, "ICP fit": 87, "Buyer intent": 91, "Urgency": 78}
  },
  {
    id: 3, source: "Reddit", sourceClass: "reddit", sourceMark: "r/", community: "r/webdev", time: "2 hr ago", level: "Medium intent", score: 76, saved: false,
    title: "Do you run a manual checklist after deploying a client project?",
    excerpt: "Curious how agencies verify forms, auth, and payment flows without spending hours clicking through everything.",
    author: "u/quietdeploy · 14 comments",
    body: ["Curious how agencies verify forms, auth, and payment flows after deployment without spending hours clicking through everything.", "We have a checklist in Notion but it gets skipped when deadlines are tight."],
    reasons: ["Manual QA workflow", "Repeated browser tasks", "Seeking a better process", "Agency, not core ICP"],
    scores: {"Problem fit": 88, "ICP fit": 61, "Buyer intent": 76, "Urgency": 67}
  },
  {
    id: 4, source: "X", sourceClass: "x", sourceMark: "𝕏", community: "@devonships", time: "5 hr ago", level: "Problem signal", score: 68, saved: false,
    title: "Spent my morning fixing selectors instead of shipping the feature",
    excerpt: "Playwright is great until a harmless UI refactor turns the whole suite into a Christmas tree.",
    author: "Devon Park · Indie developer",
    body: ["Spent my morning fixing selectors instead of shipping the feature. Playwright is great until a harmless UI refactor turns the whole suite into a Christmas tree."],
    reasons: ["Clear maintenance pain", "Uses an existing solution", "Technical decision maker", "No request for alternatives yet"],
    scores: {"Problem fit": 89, "ICP fit": 74, "Buyer intent": 49, "Urgency": 61}
  }
];

let selectedId = 1;
let activeFilter = "all";

const list = document.getElementById("match-list");
const detail = document.getElementById("match-detail");

function levelClass(level) {
  if (level === "Medium intent") return "medium";
  if (level === "Problem signal") return "low";
  return "";
}

function renderList() {
  const visible = matches.filter(m => activeFilter === "all" || activeFilter === "high" && m.score >= 85 || activeFilter === "unread" && m.id !== 4 || activeFilter === "saved" && m.saved);
  list.innerHTML = visible.map(m => `
    <article class="match-card ${m.id === selectedId ? "selected" : ""}" data-match-id="${m.id}" tabindex="0">
      <div class="match-top"><span class="source-badge"><i class="source-dot ${m.sourceClass}">${m.sourceMark}</i>${m.source}</span><span class="community">${m.community}</span><span class="timestamp">${m.time}</span></div>
      <h2>${m.title}</h2><p>${m.excerpt}</p>
      <div class="match-bottom"><span class="intent-pill ${levelClass(m.level)}">${m.level}</span><span class="match-score"><b>${m.score}</b><span>/100</span></span></div>
    </article>`).join("") || `<div style="padding:40px;text-align:center;color:#687069;font-size:.75rem">No matches in this view yet.</div>`;
  list.querySelectorAll(".match-card").forEach(card => {
    const select = () => { selectedId = Number(card.dataset.matchId); renderList(); renderDetail(); if (window.innerWidth <= 820) detail.classList.add("mobile-open"); };
    card.addEventListener("click", select);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") select(); });
  });
}

function renderDetail() {
  const m = matches.find(x => x.id === selectedId) || matches[0];
  detail.innerHTML = `<div class="detail-inner">
    <div class="detail-top"><span class="source-badge"><i class="source-dot ${m.sourceClass}">${m.sourceMark}</i>${m.source}</span><span class="community">${m.community} · ${m.time}</span><div class="detail-actions"><button class="save-match ${m.saved ? "active" : ""}" aria-label="Save match">${m.saved ? "★" : "☆"}</button><button aria-label="More options">•••</button></div></div>
    <h2 class="detail-title">${m.title}</h2><div class="author-line">Posted by ${m.author}</div>
    <div class="post-box">${m.body.map(p => `<p>${p}</p>`).join("")}</div>
    <div class="why-box"><div class="why-heading"><span>✦</span> Why this matched</div><ul class="reason-list">${m.reasons.map(r => `<li>${r}</li>`).join("")}</ul></div>
    <div class="score-section"><div class="score-header"><h3>Intent breakdown</h3><span>AI confidence: high</span></div><div class="score-grid">${Object.entries(m.scores).map(([k,v]) => `<div class="score-row"><label>${k}</label><b>${v}</b><div class="score-bar"><i style="width:${v}%"></i></div></div>`).join("")}</div></div>
    <div class="detail-cta"><button class="open">Open conversation ↗</button><button class="draft" data-open-reply>✦ Draft a reply</button></div>
    <div class="feedback-row"><span>Was this useful?</span><button data-feedback="good">👍 Good match</button><button data-feedback="bad">👎 Not relevant</button></div>
  </div>`;
  detail.querySelector(".save-match").addEventListener("click", () => { m.saved = !m.saved; renderDetail(); showToast(m.saved ? "Saved to your matches" : "Removed from saved matches"); });
  detail.querySelector("[data-open-reply]").addEventListener("click", () => openModal("reply-modal"));
  detail.querySelectorAll("[data-feedback]").forEach(btn => btn.addEventListener("click", () => { btn.classList.add("active"); showToast(btn.dataset.feedback === "good" ? "Thanks — Signalbox will learn from this" : "Hidden and added to your feedback examples"); }));
  detail.querySelector(".detail-inner").addEventListener("click", e => { if (window.innerWidth <= 820 && e.clientY < 55) detail.classList.remove("mobile-open"); });
}

document.querySelectorAll(".nav-item").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
document.querySelectorAll("[data-view-link]").forEach(btn => btn.addEventListener("click", e => { e.preventDefault(); showView(btn.dataset.viewLink); }));
document.querySelectorAll("[data-view-jump]").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.viewJump)));

function showView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === name));
  window.scrollTo({top: 0, behavior: "smooth"});
}

document.querySelectorAll(".filter-tabs button").forEach(btn => btn.addEventListener("click", () => {
  activeFilter = btn.dataset.filter;
  document.querySelectorAll(".filter-tabs button").forEach(b => b.classList.toggle("active", b === btn));
  renderList();
}));

function openModal(id) { const modal = document.getElementById(id); modal.classList.add("open"); modal.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden"; }
function closeModal(modal) { modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; }
document.querySelectorAll("[data-open-monitor]").forEach(btn => btn.addEventListener("click", () => { wizardStep = 1; updateWizard(); openModal("monitor-modal"); }));
document.querySelectorAll("[data-close-modal]").forEach(btn => btn.addEventListener("click", () => closeModal(btn.closest(".modal-backdrop"))));
document.querySelectorAll(".modal-backdrop").forEach(bg => bg.addEventListener("click", e => { if (e.target === bg) closeModal(bg); }));
document.addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".modal-backdrop.open").forEach(closeModal); });

let wizardStep = 1;
const nextButton = document.getElementById("wizard-next");
const backButton = document.getElementById("wizard-back");
function updateWizard() {
  document.getElementById("step-number").textContent = wizardStep;
  document.querySelectorAll(".wizard-step").forEach(s => s.classList.toggle("active", Number(s.dataset.step) === wizardStep));
  document.querySelectorAll(".step-progress i").forEach((i, index) => i.classList.toggle("active", index < wizardStep));
  backButton.style.visibility = wizardStep === 1 ? "hidden" : "visible";
  nextButton.textContent = wizardStep === 3 ? "Create monitor" : "Continue";
}
nextButton.addEventListener("click", () => { if (wizardStep < 3) { wizardStep++; updateWizard(); } else { closeModal(document.getElementById("monitor-modal")); showView("monitors"); showToast("Monitor created — first scan queued"); } });
backButton.addEventListener("click", () => { if (wizardStep > 1) { wizardStep--; updateWizard(); } });

const replyText = document.getElementById("reply-text");
replyText.addEventListener("input", () => document.getElementById("char-count").textContent = replyText.value.length);
document.querySelectorAll(".tone-row button").forEach(btn => btn.addEventListener("click", () => { document.querySelectorAll(".tone-row button").forEach(b => b.classList.toggle("active", b === btn)); }));
document.getElementById("copy-reply").addEventListener("click", async () => { try { await navigator.clipboard.writeText(replyText.value); showToast("Draft copied to clipboard"); } catch { showToast("Draft ready to copy"); } });

const scoreRange = document.getElementById("score-range");
scoreRange.addEventListener("input", () => document.getElementById("score-output").textContent = scoreRange.value);
document.getElementById("save-settings").addEventListener("click", () => showToast("Settings saved"));

let toastTimer;
function showToast(message) { const toast = document.getElementById("toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove("show"), 2300); }

renderList();
renderDetail();
updateWizard();
