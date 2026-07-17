(() => {
  "use strict";

  const C = window.APP_CONFIG || {};
  const API_URL = C.API_URL || "";
  const REFRESH_MS = (C.REFRESH_SECONDS || 30) * 1000;
  const PAGE_SIZE = C.PAGE_SIZE || 10;
  const CACHE_KEY = "kpiDashboardV3Lite";

  const CATEGORIES = [
    "ทั้งหมด",
    "Agenda Base",
    "Function Base",
    "Potential Base",
    "ส่วนที่ 2 ยุทธศาสตร์หน่วยงาน"
  ];

  const state = {
    all: [],
    filtered: [],
    category: "ทั้งหมด",
    quarter: "latest",
    page: 1,
    openRows: new Set()
  };

  const $ = id => document.getElementById(id);

  const clean = value => String(value ?? "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const escapeHtml = value => clean(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  const normalizeCategory = value => {
    const s = clean(value).toLowerCase()
      .replace(/[–—_-]+/g, " ")
      .replace(/\s+/g, " ");

    if (s.includes("agenda")) return "Agenda Base";
    if (s.includes("function")) return "Function Base";
    if (s.includes("potential")) return "Potential Base";
    if (s.includes("ส่วนที่ 2") || s.includes("ยุทธศาสตร์หน่วยงาน")) {
      return "ส่วนที่ 2 ยุทธศาสตร์หน่วยงาน";
    }
    return "";
  };

  const fallbackCategory = (row, index) => {
    const match = clean(row?.no).match(/\d+/);
    const n = match ? Number(match[0]) : index + 1;

    if (n >= 1 && n <= 5) return "Agenda Base";
    if (n >= 6 && n <= 24) return "Function Base";
    if (n >= 25 && n <= 29) return "Potential Base";
    if (n === 30) return "ส่วนที่ 2 ยุทธศาสตร์หน่วยงาน";
    return "";
  };

  const categoryForRow = (row, index) =>
    normalizeCategory(row?.category || row?.type || row?.["ประเภท"]) ||
    fallbackCategory(row, index);

  const unique = values => [...new Set(values.map(clean).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "th"));

  const quarterLabel = key => ({
    q1: "ไตรมาส 1",
    q2: "ไตรมาส 2",
    q3: "ไตรมาส 3",
    q4: "ไตรมาส 4"
  }[key] || "ผลล่าสุด");

  const latestQuarter = row => ["q4", "q3", "q2", "q1"]
    .find(key => clean(row[key])) || "";

  const selectedQuarter = row =>
    state.quarter === "latest" ? latestQuarter(row) : state.quarter;

  const hasQuarterData = row => {
    const q = selectedQuarter(row);
    return Boolean(q && clean(row[q]));
  };

  const extractPercent = text => {
    const s = clean(text).replace(/,/g, "");
    const percentMatches = [...s.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:%|ร้อยละ)/gi)];
    if (percentMatches.length) {
      return Number(percentMatches[percentMatches.length - 1][1]);
    }

    const reverseMatches = [...s.matchAll(/(?:ร้อยละ)\s*(-?\d+(?:\.\d+)?)/gi)];
    if (reverseMatches.length) {
      return Number(reverseMatches[reverseMatches.length - 1][1]);
    }
    return null;
  };

  const extractTarget = text => {
    const s = clean(text).replace(/,/g, "");
    const match = s.match(/(-?\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
  };

  const isCeiling = text =>
    /(ไม่เกิน|น้อยกว่า|ต่ำกว่า|≤|<=|สูงสุด)/.test(clean(text));

  const resultView = row => {
    const q = selectedQuarter(row);
    const text = q ? clean(row[q]) : "";
    const achieved = extractPercent(text);
    const target = extractTarget(row.target);

    if (!text) {
      return { q, text: "", status: "pending", label: "รอข้อมูล" };
    }

    if (achieved !== null && target !== null) {
      const ok = isCeiling(row.target) ? achieved <= target : achieved >= target;
      return {
        q,
        text,
        achieved,
        target,
        status: ok ? "achieved" : "watch",
        label: ok ? "บรรลุเป้าหมาย" : "เฝ้าระวัง"
      };
    }

    return { q, text, status: "watch", label: "เฝ้าระวัง" };
  };

  const formatDate = value => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return clean(value);

    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Bangkok"
    }).format(date);
  };

  const toast = message => {
    const el = $("toast");
    el.textContent = message;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
  };

  const setLoading = show => $("loading").classList.toggle("show", show);

  function setConnection(online, updatedAt) {
    $("statusDot").classList.toggle("online", online);
    $("connectionText").textContent = online ? "Online" : "Offline";
    $("lastUpdated").textContent = online
      ? `อัปเดต ${formatDate(updatedAt)}`
      : "ใช้ข้อมูลสำรองล่าสุด";
  }

  async function loadData(manual = false) {
    if (manual) setLoading(true);

    try {
      const separator = API_URL.includes("?") ? "&" : "?";
      const response = await fetch(
        `${API_URL}${separator}action=data&t=${Date.now()}`,
        { cache: "no-store", redirect: "follow" }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const json = await response.json();
      if (json.status !== "ok") throw new Error(json.message || "API error");

      state.all = (json.data || []).map((row, index) => ({
        ...row,
        no: clean(row.no) || String(index + 1),
        category: categoryForRow(row, index),
        unit: clean(row.unit || row.department || row["หน่วยงาน"]),
        owner: clean(row.owner || row.responsible || row["ผู้รับผิดชอบ"])
      }));

      localStorage.setItem(CACHE_KEY, JSON.stringify({
        rows: state.all,
        fetchedAt: json.fetched_at || new Date().toISOString()
      }));

      setConnection(true, json.fetched_at || new Date().toISOString());
      populateFilters();
      renderAll();

      if (manual) toast("อัปเดตข้อมูลเรียบร้อยแล้ว");
    } catch (error) {
      console.error(error);
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");

      if (cache?.rows?.length) {
        state.all = cache.rows;
        setConnection(false, cache.fetchedAt);
        populateFilters();
        renderAll();
        toast("เชื่อมต่อไม่ได้ กำลังแสดงข้อมูลสำรองล่าสุด");
      } else {
        setConnection(false);
        toast(`โหลดข้อมูลไม่ได้: ${error.message || "กรุณาตรวจสอบ Apps Script"}`);
      }
    } finally {
      setLoading(false);
    }
  }

  function fillSelect(select, items, defaultLabel) {
    const oldValue = select.value;
    select.innerHTML =
      `<option value="">${defaultLabel}</option>` +
      items.map(item =>
        `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`
      ).join("");
    select.value = items.includes(oldValue) ? oldValue : "";
  }

  function populateFilters() {
    fillSelect($("unitFilter"), unique(state.all.map(row => row.unit)), "ทุกหน่วยงาน");
    fillSelect($("ownerFilter"), unique(state.all.map(row => row.owner)), "ทุกผู้รับผิดชอบ");
  }

  function countCategories() {
    const counts = Object.fromEntries(CATEGORIES.map(category => [category, 0]));
    counts["ทั้งหมด"] = state.all.length;

    state.all.forEach(row => {
      if (counts[row.category] !== undefined) counts[row.category] += 1;
    });
    return counts;
  }

  function renderCategoryTabs() {
    const counts = countCategories();
    const uncategorized = state.all.filter(row => !CATEGORIES.includes(row.category)).length;

    $("uncategorizedNotice").hidden = uncategorized === 0;
    $("uncategorizedNotice").textContent =
      uncategorized ? `ยังไม่ระบุหมวด ${uncategorized} รายการ` : "";

    $("categoryTabs").innerHTML = CATEGORIES.map(category => `
      <button type="button"
        class="category-btn ${state.category === category ? "active" : ""}"
        data-category="${escapeHtml(category)}">
        <span class="category-name">${escapeHtml(category)}</span>
        <span class="category-count">${counts[category] || 0}</span>
      </button>
    `).join("");

    $("categoryTabs").querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        state.category = button.dataset.category;
        state.page = 1;
        renderAll();
      });
    });
  }

  function applyFilters() {
    const keyword = clean($("searchInput").value).toLowerCase();
    const unit = $("unitFilter").value;
    const owner = $("ownerFilter").value;
    const dataStatus = $("dataFilter").value;

    state.filtered = state.all.filter(row => {
      const categoryOk =
        state.category === "ทั้งหมด" || row.category === state.category;

      const searchable = [
        row.no, row.indicator, row.project, row.target,
        row.category, row.unit, row.owner
      ].map(clean).join(" ").toLowerCase();

      const hasData = hasQuarterData(row);
      const dataOk =
        !dataStatus ||
        (dataStatus === "complete" ? hasData : !hasData);

      return categoryOk &&
        (!keyword || searchable.includes(keyword)) &&
        (!unit || row.unit === unit) &&
        (!owner || row.owner === owner) &&
        dataOk;
    });

    const maxPage = Math.max(1, Math.ceil(state.filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, maxPage);
  }

  function renderSummary() {
    const views = state.filtered.map(resultView);
    const total = views.length;
    const achieved = views.filter(view => view.status === "achieved").length;
    const watch = views.filter(view => view.status === "watch").length;
    const pending = views.filter(view => view.status === "pending").length;

    $("totalCount").textContent = total;
    $("achievedCount").textContent = achieved;
    $("watchCount").textContent = watch;
    $("pendingCount").textContent = pending;

    $("achievedPct").textContent = total ? `${(achieved / total * 100).toFixed(1)}%` : "0%";
    $("watchPct").textContent = total ? `${(watch / total * 100).toFixed(1)}%` : "0%";
    $("pendingPct").textContent = total ? `${(pending / total * 100).toFixed(1)}%` : "0%";
    $("resultCount").textContent = `${total} รายการ`;

    $("resultHeader").textContent =
      state.quarter === "latest" ? "ผลล่าสุด" : `ผล${quarterLabel(state.quarter)}`;
  }

  function renderActiveFilters() {
    const parts = [];
    if (state.category !== "ทั้งหมด") parts.push(state.category);
    if ($("quarterFilter").value !== "latest") parts.push(quarterLabel(state.quarter));
    if ($("unitFilter").value) parts.push($("unitFilter").value);
    if ($("ownerFilter").value) parts.push($("ownerFilter").value);
    if ($("dataFilter").value === "complete") parts.push("มีข้อมูล");
    if ($("dataFilter").value === "pending") parts.push("รอข้อมูล");
    if (clean($("searchInput").value)) parts.push(`ค้นหา “${clean($("searchInput").value)}”`);

    $("activeFilterLine").textContent =
      parts.length ? `ตัวกรองที่ใช้: ${parts.join(" • ")}` : "";
  }

  function statusClass(status) {
    return {
      achieved: "status-achieved",
      watch: "status-watch",
      pending: "status-pending"
    }[status] || "status-pending";
  }

  function detailHtml(row) {
    return `
      <div class="detail-panel">
        <div class="detail-block wide">
          <b>โครงการ/กิจกรรม</b>
          <p>${escapeHtml(row.project || "—")}</p>
        </div>
        <div class="detail-block">
          <b>หน่วยงาน</b>
          <p>${escapeHtml(row.unit || "—")}</p>
        </div>
        <div class="detail-block">
          <b>ผู้รับผิดชอบ</b>
          <p>${escapeHtml(row.owner || "—")}</p>
        </div>
        <div class="detail-block wide">
          <b>ผลการดำเนินงานรายไตรมาส</b>
          <div class="quarter-grid">
            ${["q1","q2","q3","q4"].map(q => `
              <div class="quarter-box">
                <span>${quarterLabel(q)}</span>
                <p>${escapeHtml(row[q] || "รอข้อมูล")}</p>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="detail-block">
          <b>อัปเดตล่าสุด</b>
          <p>${escapeHtml(formatDate(row.updated_at || row.source_updated_at))}</p>
        </div>
        <div class="detail-block full">
          <b>หมายเหตุ</b>
          <p>${escapeHtml(row.note || "—")}</p>
        </div>
      </div>
    `;
  }

  function renderTable() {
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = state.filtered.slice(start, start + PAGE_SIZE);

    $("emptyState").hidden = pageRows.length > 0;

    $("kpiBody").innerHTML = pageRows.map((row, index) => {
      const result = resultView(row);
      const rowKey = `${row.no}-${start + index}`;
      const isOpen = state.openRows.has(rowKey);
      const resultText = result.text || "รอข้อมูล";

      return `
        <tr class="data-row">
          <td data-label="ลำดับ">${escapeHtml(row.no)}</td>
          <td data-label="ชื่อตัวชี้วัด">
            <div class="indicator-name">${escapeHtml(row.indicator || "—")}</div>
            ${row.project ? `<div class="indicator-project">${escapeHtml(row.project)}</div>` : ""}
          </td>
          <td data-label="ประเภท">
            <span class="category-tag">${escapeHtml(row.category || "ยังไม่ระบุหมวด")}</span>
          </td>
          <td data-label="เป้าหมาย">${escapeHtml(row.target || "—")}</td>
          <td data-label="ผลการดำเนินงาน">
            ${escapeHtml(resultText)}
            <span class="quarter-label">${result.q ? quarterLabel(result.q) : "รอข้อมูล"}</span>
          </td>
          <td data-label="สถานะ">
            <span class="status-badge ${statusClass(result.status)}">${result.label}</span>
          </td>
          <td data-label="รายละเอียด">
            <button type="button" class="detail-btn" data-row="${escapeHtml(rowKey)}"
              aria-expanded="${isOpen}">${isOpen ? "−" : "+"}</button>
          </td>
        </tr>
        <tr class="detail-row ${isOpen ? "open" : ""}" data-detail="${escapeHtml(rowKey)}">
          <td colspan="7">${detailHtml(row)}</td>
        </tr>
      `;
    }).join("");

    $("kpiBody").querySelectorAll(".detail-btn").forEach(button => {
      button.addEventListener("click", () => {
        const key = button.dataset.row;
        if (state.openRows.has(key)) state.openRows.delete(key);
        else state.openRows.add(key);
        renderTable();
      });
    });

    const total = state.filtered.length;
    const end = Math.min(start + PAGE_SIZE, total);
    $("pageInfo").textContent = total
      ? `แสดง ${start + 1}–${end} จาก ${total} รายการ`
      : "ไม่พบรายการ";

    renderPagination(total);
  }

  function renderPagination(total) {
    const pageCount = Math.ceil(total / PAGE_SIZE);
    if (pageCount <= 1) {
      $("pages").innerHTML = "";
      return;
    }

    const items = [];
    for (let page = 1; page <= pageCount; page++) {
      if (page === 1 || page === pageCount || Math.abs(page - state.page) <= 1) {
        items.push(page);
      } else if (items[items.length - 1] !== "…") {
        items.push("…");
      }
    }

    $("pages").innerHTML = items.map(item =>
      item === "…"
        ? `<span>…</span>`
        : `<button type="button" class="page-btn ${item === state.page ? "active" : ""}" data-page="${item}">${item}</button>`
    ).join("");

    $("pages").querySelectorAll("button").forEach(button => {
      button.addEventListener("click", () => {
        state.page = Number(button.dataset.page);
        renderTable();
        document.querySelector(".list-section").scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function renderAll() {
    applyFilters();
    renderCategoryTabs();
    renderSummary();
    renderActiveFilters();
    renderTable();
  }

  function clearFilters() {
    state.category = "ทั้งหมด";
    state.quarter = "latest";
    state.page = 1;
    state.openRows.clear();

    $("searchInput").value = "";
    $("quarterFilter").value = "latest";
    $("unitFilter").value = "";
    $("ownerFilter").value = "";
    $("dataFilter").value = "";
    $("moreFilter").open = false;

    renderAll();
  }

  function exportExcel() {
    const rows = state.filtered.map(row => ({
      "ลำดับ": row.no,
      "ประเภท": row.category,
      "ชื่อตัวชี้วัด": row.indicator,
      "โครงการ/กิจกรรม": row.project,
      "เป้าหมาย": row.target,
      "ไตรมาส 1": row.q1,
      "ไตรมาส 2": row.q2,
      "ไตรมาส 3": row.q3,
      "ไตรมาส 4": row.q4,
      "หน่วยงาน": row.unit,
      "ผู้รับผิดชอบ": row.owner,
      "หมายเหตุ": row.note
    }));

    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "KPI");
    XLSX.writeFile(workbook, "KPI-โรงพยาบาลกลาง-2569-V3-Lite.xlsx");
  }

  function bindEvents() {
    $("searchInput").addEventListener("input", () => {
      state.page = 1;
      renderAll();
    });

    $("quarterFilter").addEventListener("change", event => {
      state.quarter = event.target.value;
      state.page = 1;
      renderAll();
    });

    ["unitFilter", "ownerFilter", "dataFilter"].forEach(id => {
      $(id).addEventListener("change", () => {
        state.page = 1;
        renderAll();
      });
    });

    $("clearBtn").addEventListener("click", clearFilters);
    $("refreshBtn").addEventListener("click", () => loadData(true));
    $("excelBtn").addEventListener("click", exportExcel);
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    loadData(true);
    setInterval(() => loadData(false), REFRESH_MS);
  });
})();
