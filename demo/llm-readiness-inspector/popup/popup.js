function getStatus(score) {
  if (score > 80) return { text: "Excellent", color: "#22c55e" };
  if (score > 60) return { text: "Good", color: "#6366f1" };
  return { text: "Needs Work", color: "#ef4444" };
}

chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {

  chrome.tabs.sendMessage(tabs[0].id, { action: "analyze" }, function (res) {

    if (!res || res.error) {
      document.getElementById("score").innerText = "ERR";
      return;
    }

    const score = res.llm_readiness_score;

    document.getElementById("score").innerText = score;

    const deg = score * 3.6;
    const status = getStatus(score);

    document.getElementById("ring").style.background =
      `conic-gradient(${status.color} ${deg}deg, #1e293b ${deg}deg)`;

    document.getElementById("status").innerText = status.text;
    document.getElementById("status").style.color = status.color;

    document.getElementById("markdown").innerText = res.scores.markdown;
    document.getElementById("extract").innerText = res.scores.extractability;
    document.getElementById("token").innerText = res.scores.token_efficiency;
    document.getElementById("conversion").innerText = res.scores.conversion;

    document.getElementById("words").innerText = res.stats.wordCount;
    document.getElementById("sent").innerText = res.stats.avgSentence.toFixed(1);
    document.getElementById("red").innerText = (res.stats.redundancy * 100).toFixed(0) + "%";

    const issues = document.getElementById("issues");
    issues.innerHTML = "";
    res.top_issues.forEach(i => {
      const li = document.createElement("li");
      li.innerText = i;
      issues.appendChild(li);
    });

    const fixes = document.getElementById("fixes");
    fixes.innerHTML = "";
    res.quick_fixes.forEach(f => {
      const li = document.createElement("li");
      li.innerText = f;
      fixes.appendChild(li);
    });

    document.getElementById("export").onclick = () => {
      const blob = new Blob([JSON.stringify(res, null, 2)]);
      const url = URL.createObjectURL(blob);
      chrome.downloads.download({ url, filename: "llm-report.json" });
    };

  });

});
