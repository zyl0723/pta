/*!
 * 留言板：把开源评论组件 giscus 挂到 board.html 上。
 *
 * giscus 是 MIT 许可的开源项目（https://github.com/giscus/giscus，版权归其作者所有），
 * 它把留言存进本仓库的 GitHub Discussions：
 *   - 公开可见（任何人不登录也能看）；
 *   - 永久保存，并显示发布时间；
 *   - 只有「留言本人」和「仓库管理员」能删除自己的/任何一条留言；
 *   - 只有公开回复，没有私聊功能。
 * 本文件不保存、不上传任何数据，只负责把 giscus 的官方脚本插进页面。
 *
 * 站长一次性配置（做完这一步留言板才会出现留言框）：
 *   1. 打开仓库 Settings → General → Features，勾上 Discussions；
 *   2. 在 Discussions 里新建一个分类（建议叫「留言板」）；
 *   3. 打开 https://giscus.app ，按提示给仓库装上 giscus app，填好仓库名与分类，
 *      页面下方会给出 data-repo-id 和 data-category-id 两串 ID；
 *   4. 把这两串 ID 填到下面 CONFIG 的 repoId / categoryId 里，重新部署即可。
 * 没填之前，页面会显示这段配置说明，其它内容照常可用。
 */
(function () {
  "use strict";

  var CONFIG = {
    repo: "zyl0723/pta",
    repoId: "R_kgDOVCSHPg", /* 仓库 ID（用 GitHub API 查到的，不用手填） */
    category: "General",    /* 留言用的 Discussions 分类；以后想换成自己新建的分类，改这里 + 下面那行的 ID */
    categoryId: "DIC_kwDOVCSHPs4DHff0",
    mapping: "specific",   /* 整个网站共用一条 Discussion（下面 term 给它起名） */
    term: "pta-board",     /* 这条 Discussion 的名字，改它等于换一块留言板 */
    reactions: "1",
    inputPosition: "top",
    lang: "zh-CN"
  };

  function $(id) { return document.getElementById(id); }

  function setState(text) {
    var el = $("board-state");
    if (el) el.textContent = text;
  }

  /* 还没配置：把要做的事写清楚，页面其它部分照常能用 */
  function renderSetup(host) {
    setState("还没开通");
    host.innerHTML =
      '<div class="board-setup">'
      + "<h3>留言板还没开通：站长需要先做 4 步（一次性的）</h3>"
      + "<ol>"
      + "<li>打开仓库 <code>" + CONFIG.repo + "</code> 的 Settings → General → Features，勾上 <b>Discussions</b>。</li>"
      + "<li>在 Discussions 里新建一个分类，名字建议就用 <code>" + CONFIG.category + "</code>。</li>"
      + '<li>打开 <a href="https://giscus.app" target="_blank" rel="noopener noreferrer">giscus.app</a>，按提示给仓库装上 giscus app，填好仓库名和分类，页面下方会给出两串 ID。</li>'
      + "<li>把 <code>data-repo-id</code> 和 <code>data-category-id</code> 填进 <code>assets/js/board.js</code> 顶部的 CONFIG，重新部署即可。</li>"
      + "</ol>"
      + "<p class=\"dim\">在站长配置好之前，这里暂时不能留言；上面的说明、以及左侧那个做题网址都不受影响。</p>"
      + "</div>";
  }

  function renderGiscus(host) {
    setState("加载中…");
    var s = document.createElement("script");
    s.src = "https://giscus.app/client.js";
    s.async = true;
    s.crossOrigin = "anonymous";
    s.setAttribute("data-repo", CONFIG.repo);
    s.setAttribute("data-repo-id", CONFIG.repoId);
    s.setAttribute("data-category", CONFIG.category);
    s.setAttribute("data-category-id", CONFIG.categoryId);
    s.setAttribute("data-mapping", CONFIG.mapping);
    s.setAttribute("data-term", CONFIG.term);
    s.setAttribute("data-strict", "0");
    s.setAttribute("data-reactions-enabled", CONFIG.reactions);
    s.setAttribute("data-emit-metadata", "0");
    s.setAttribute("data-input-position", CONFIG.inputPosition);
    s.setAttribute("data-theme", "light");
    s.setAttribute("data-lang", CONFIG.lang);
    s.setAttribute("data-loading", "lazy");
    host.appendChild(s);
    setState("公开 · 永久保存 · 显示时间");
  }

  function init() {
    var host = $("board");
    if (!host) return;
    if (!CONFIG.repoId || !CONFIG.categoryId) {
      renderSetup(host);
      return;
    }
    renderGiscus(host);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
