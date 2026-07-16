
(() => {
  "use strict";
  const C = window.APP_CONFIG || {};
  const API_URL = C.API_URL || "";
  const REFRESH_MS = (C.REFRESH_SECONDS || 30) * 1000;
  const PAGE_SIZE = C.PAGE_SIZE || 10;
  const CATEGORY_ORDER = ["ทั้งหมด","Agenda Base","Function Base","Potential Base","ส่วนที่ 2 ยุทธศาสตร์หน่วยงาน"];

  const state = {all:[], filtered:[], category:"ทั้งหมด", page:1, auto:true, timer:null, charts:{}};
  const $ = id => document.getElementById(id);
  const clean = v => String(v ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();
  const normalizeCategory = v => {
    const s = clean(v).toLowerCase().replace(/[–—_-]+/g," ").replace(/\s+/g," ");
    if (s.includes("agenda")) return "Agenda Base";
    if (s.includes("function")) return "Function Base";
    if (s.includes("potential")) return "Potential Base";
    if (s.includes("ส่วนที่ 2") || s.includes("ยุทธศาสตร์หน่วยงาน")) return "ส่วนที่ 2 ยุทธศาสตร์หน่วยงาน";
    return clean(v);
  };
  const escapeHtml = s => clean(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
  const unique = arr => [...new Set(arr.map(clean).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"th"));
  const latestQuarter = row => ["q4","q3","q2","q1"].find(q=>clean(row[q])) || "";
  const qLabel = q => ({q1:"ไตรมาส 1",q2:"ไตรมาส 2",q3:"ไตรมาส 3",q4:"ไตรมาส 4"}[q]||"");
  const extractPct = text => {
    const s = clean(text).replace(/,/g,"");
    const matches = [...s.matchAll(/(?:ร้อยละ|%)[^\d-]*(-?\d+(?:\.\d+)?)/gi)];
    if (matches.length) return Number(matches[matches.length-1][1]);
    const tail = s.match(/(-?\d+(?:\.\d+)?)\s*%/);
    return tail ? Number(tail[1]) : null;
  };
  const extractTarget = text => {
    const s = clean(text).replace(/,/g,"");
    const m = s.match(/(?:ร้อยละ|%|ไม่น้อยกว่า|อย่างน้อย|มากกว่า|ไม่เกิน|≤|>=|≥|<=)?\s*(-?\d+(?:\.\d+)?)/i);
    return m ? Number(m[1]) : null;
  };
  const isCeiling = text => /(ไม่เกิน|น้อยกว่า|≤|<=|สูงสุด)/.test(clean(text));
  const compute = row => {
    const q = latestQuarter(row), latest = q ? clean(row[q]) : "";
    const achieved = extractPct(latest);
    const target = extractTarget(row.target);
    let status = "pending", progress = 0;
    if (achieved !== null && target !== null && target !== 0) {
      const ok = isCeiling(row.target) ? achieved <= target : achieved >= target;
      status = ok ? "achieved" : "watch";
      progress = isCeiling(row.target) ? Math.min(100,(target/Math.max(achieved,.0001))*100) : Math.min(100,(achieved/target)*100);
    } else if (latest) {
      status = "watch";
      progress = 60;
    }
    return {...row,_q:q,_latest:latest,_achieved:achieved,_target:target,_status:status,_progress:Math.max(0,progress)};
  };
  const toast = msg => { const el=$("toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2500); };
  const loading = show => $("loading").classList.toggle("show",show);
  const formatDate = v => {
    if(!v) return "—";
    const d = new Date(v); if(Number.isNaN(d.getTime())) return clean(v);
    return new Intl.DateTimeFormat("th-TH",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Bangkok"}).format(d);
  };
  function setConnection(ok, fetchedAt){
    $("statusDot").classList.toggle("online",ok);
    $("connectionText").textContent=ok?"Online":"Offline";
    $("connectionSub").textContent=ok?"เชื่อมต่อข้อมูลสำเร็จ":"ใช้ข้อมูลล่าสุดที่มี";
    if(fetchedAt) $("lastUpdated").textContent=formatDate(fetchedAt);
  }
  async function loadData(manual=false){
    if(manual) loading(true);
    try{
      const sep=API_URL.includes("?")?"&":"?";
      const res=await fetch(`${API_URL}${sep}action=data&t=${Date.now()}`,{cache:"no-store",redirect:"follow"});
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json=await res.json();
      if(json.status!=="ok") throw new Error(json.message||"API error");
      const rows=(json.data||[]).map(r=>compute({...r, category:normalizeCategory(r.category)}));
      state.all=rows;
      localStorage.setItem("kpiCache",JSON.stringify({rows,fetched_at:json.fetched_at}));
      setConnection(true,json.fetched_at);
      populateFilters(); renderAll();
      if(manual) toast("อัปเดตข้อมูลเรียบร้อยแล้ว");
    }catch(err){
      console.error(err);
      const cache=JSON.parse(localStorage.getItem("kpiCache")||"null");
      if(cache?.rows?.length){state.all=cache.rows;setConnection(false,cache.fetched_at);populateFilters();renderAll();toast("เชื่อมต่อไม่ได้ กำลังแสดงข้อมูลล่าสุดที่บันทึกไว้");}
      else{setConnection(false);toast("ไม่สามารถโหลดข้อมูลได้ กรุณาตรวจสอบ Apps Script");}
    }finally{loading(false)}
  }
  function populateFilters(){
    fillSelect($("unitFilter"),unique(state.all.map(x=>x.unit)),"ทุกหน่วยงาน");
    fillSelect($("ownerFilter"),unique(state.all.map(x=>x.owner)),"ทุกผู้รับผิดชอบ");
    renderTabs();
  }
  function fillSelect(el,items,label){
    const old=el.value;
    const emptyText = label.includes("หน่วยงาน") ? "ยังไม่มีข้อมูลหน่วยงานในชีต" : "ยังไม่มีข้อมูลผู้รับผิดชอบในชีต";
    el.innerHTML=`<option value="">${label}</option>` + (items.length ? items.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join("") : `<option value="" disabled>${emptyText}</option>`);
    el.value=items.includes(old)?old:"";
  }
  function renderTabs(){
    const counts=Object.fromEntries(CATEGORY_ORDER.map(c=>[c,c==="ทั้งหมด"?state.all.length:state.all.filter(x=>normalizeCategory(x.category)===c).length]));
    $("categoryTabs").innerHTML=CATEGORY_ORDER.map(c=>`<button class="cat-btn ${state.category===c?"active":""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)} <span class="count">${counts[c]||0}</span></button>`).join("");
    $("categoryTabs").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.category=b.dataset.cat;state.page=1;renderTabs();renderAll();});
  }
  function applyFilters(){
    const term=clean($("searchInput").value).toLowerCase(), unit=$("unitFilter").value, owner=$("ownerFilter").value, data=$("dataFilter").value;
    state.filtered=state.all.filter(x=>{
      const catOk=state.category==="ทั้งหมด"||normalizeCategory(x.category)===state.category;
      const text=[x.no,x.indicator,x.project,x.unit,x.owner,x.target].map(clean).join(" ").toLowerCase();
      const dataOk=!data||(data==="complete"?x._q:x._status==="pending");
      return catOk&&(!term||text.includes(term))&&(!unit||clean(x.unit)===unit)&&(!owner||clean(x.owner)===owner)&&dataOk;
    });
    const max=Math.max(1,Math.ceil(state.filtered.length/PAGE_SIZE)); if(state.page>max)state.page=max;
  }
  function animateNumber(el,to){
    const start=Number(el.textContent)||0,dur=500,t0=performance.now();
    const tick=t=>{const p=Math.min(1,(t-t0)/dur);el.textContent=Math.round(start+(to-start)*(1-(1-p)**3));if(p<1)requestAnimationFrame(tick)};
    requestAnimationFrame(tick);
  }
  function renderAll(){applyFilters();renderSummary();renderCharts();renderTable();}
  function renderSummary(){
    const rows=state.filtered,total=rows.length,ach=rows.filter(x=>x._status==="achieved").length,watch=rows.filter(x=>x._status==="watch").length;
    animateNumber($("totalCount"),total);animateNumber($("achievedCount"),ach);animateNumber($("watchCount"),watch);
    $("achievedPct").textContent=total?`${(ach/total*100).toFixed(2)}%`:"0%"; $("watchPct").textContent=total?`${(watch/total*100).toFixed(2)}%`:"0%";
    $("sumTotal").textContent=`${state.all.length} รายการ`; $("sumUnits").textContent=`${unique(state.all.map(x=>x.unit)).length} หน่วยงาน`;
    $("sumOwners").textContent=`${unique(state.all.map(x=>x.owner)).length} ท่าน`; $("sumPending").textContent=`${state.all.filter(x=>x._status==="pending").length} รายการ`;
    $("resultCount").textContent=`${total} รายการ`;
  }
  function chart(name,canvas,config){
    if(state.charts[name])state.charts[name].destroy(); state.charts[name]=new Chart($(canvas),config);
  }
  function renderCharts(){
    const rows=state.filtered,ach=rows.filter(x=>x._status==="achieved").length,watch=rows.filter(x=>x._status==="watch").length,pending=rows.filter(x=>x._status==="pending").length;
    const styles=getComputedStyle(document.documentElement),green=styles.getPropertyValue("--green2").trim(),amber=styles.getPropertyValue("--amber").trim(),gray=styles.getPropertyValue("--gray").trim(),ink=styles.getPropertyValue("--ink").trim(),line=styles.getPropertyValue("--line").trim();
    Chart.defaults.color=ink;Chart.defaults.font.family="'Kanit','Noto Sans Thai',sans-serif";
    chart("donut","donutChart",{type:"doughnut",data:{labels:["บรรลุเป้าหมาย","เฝ้าระวัง","รอข้อมูล"],datasets:[{data:[ach,watch,pending],backgroundColor:[green,amber,gray],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:"62%",plugins:{legend:{position:"right"}}}});
    const cats=CATEGORY_ORDER.slice(1),counts=cats.map(c=>rows.filter(x=>normalizeCategory(x.category)===c).length);
    chart("category","categoryChart",{type:"bar",data:{labels:cats.map(x=>x.replace("ส่วนที่ 2 ","ส่วนที่ 2\n")),datasets:[{label:"จำนวนตัวชี้วัด",data:counts,backgroundColor:green,borderRadius:7}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0},grid:{color:line}},x:{grid:{display:false}}}}});
    const qData=["q1","q2","q3","q4"].map(q=>{const vals=rows.map(x=>extractPct(x[q])).filter(v=>v!==null);return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null});
    chart("trend","trendChart",{type:"line",data:{labels:["ไตรมาส 1","ไตรมาส 2","ไตรมาส 3","ไตรมาส 4"],datasets:[{label:"ค่าเฉลี่ยผลการดำเนินงาน (%)",data:qData,borderColor:green,backgroundColor:"rgba(19,162,99,.12)",fill:true,tension:.35,spanGaps:true,pointRadius:5}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,grid:{color:line}},x:{grid:{display:false}}}}});
  }
  function trendInfo(r){
    const vals=["q1","q2","q3","q4"].map(q=>extractPct(r[q])).filter(v=>v!==null);
    if(vals.length<2)return["—","flat"]; const d=vals.at(-1)-vals.at(-2); return d>0.2?["↗","up"]:d<-.2?["↘","down"]:["—","flat"];
  }
  function renderTable(){
    const start=(state.page-1)*PAGE_SIZE,rows=state.filtered.slice(start,start+PAGE_SIZE);
    $("emptyState").hidden=rows.length>0;
    $("kpiBody").innerHTML=rows.map(r=>{
      const [ti,tc]=trendInfo(r),pct=r._achieved!==null?`${r._achieved.toFixed(2)}%`:"—",updated=r.updated_at||r.source_updated_at;
      return `<tr>
        <td>${escapeHtml(r.no||"—")}</td><td><b>${escapeHtml(r.indicator||"—")}</b><br><small>${escapeHtml(r.project||"")}</small></td>
        <td><span class="type-pill">${escapeHtml(r.category||"—")}</span></td><td>${escapeHtml(r.unit||"—")}</td><td>${escapeHtml(r.owner||"—")}</td>
        <td>${escapeHtml(r.target||"—")}</td><td>${escapeHtml(r._latest||"—")}<br><small>${qLabel(r._q)}</small></td>
        <td><div class="progress"><span>${pct}</span><div class="bar ${r._status==="watch"?"watch":""}"><span style="width:${Math.min(100,r._progress)}%"></span></div></div></td>
        <td><span class="trend ${tc}">${ti}</span></td><td>${formatDate(updated)}</td></tr>`;
    }).join("");
    const total=state.filtered.length,end=Math.min(start+PAGE_SIZE,total);$("pageInfo").textContent=total?`แสดง ${start+1} ถึง ${end} จาก ${total} รายการ`:"ไม่พบรายการ";
    const pages=Math.ceil(total/PAGE_SIZE),buttons=[];for(let p=1;p<=pages;p++){if(p===1||p===pages||Math.abs(p-state.page)<=1)buttons.push(p);else if(buttons.at(-1)!=="…")buttons.push("…")}
    $("pages").innerHTML=buttons.map(p=>p==="…"?`<span>…</span>`:`<button class="page-btn ${p===state.page?"active":""}" data-p="${p}">${p}</button>`).join("");
    $("pages").querySelectorAll("button").forEach(b=>b.onclick=()=>{state.page=Number(b.dataset.p);renderTable();});
  }
  function exportExcel(){
    const data=state.filtered.map(r=>({"ลำดับ":r.no,"ประเภท":r.category,"ตัวชี้วัด":r.indicator,"โครงการ/กิจกรรม":r.project,"เป้าหมาย":r.target,"ไตรมาส 1":r.q1,"ไตรมาส 2":r.q2,"ไตรมาส 3":r.q3,"ไตรมาส 4":r.q4,"หน่วยงาน":r.unit,"ผู้รับผิดชอบ":r.owner,"หมายเหตุ":r.note}));
    const ws=XLSX.utils.json_to_sheet(data),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"KPI");XLSX.writeFile(wb,"KPI-โรงพยาบาลกลาง-2569.xlsx");
  }
  function bind(){
    $("appSubtitle").textContent=C.APP_SUBTITLE||$("appSubtitle").textContent;$("refreshSeconds").textContent=C.REFRESH_SECONDS||30;
    ["searchInput","unitFilter","ownerFilter","dataFilter"].forEach(id=>$(id).addEventListener(id==="searchInput"?"input":"change",()=>{state.page=1;renderAll()}));
    $("clearBtn").onclick=()=>{$("searchInput").value="";$("unitFilter").value="";$("ownerFilter").value="";$("dataFilter").value="";state.category="ทั้งหมด";state.page=1;renderTabs();renderAll()};
    $("refreshBtn").onclick=()=>loadData(true);$("excelBtn").onclick=exportExcel;$("pdfBtn").onclick=()=>window.print();
    $("themeBtn").onclick=()=>{const dark=document.documentElement.dataset.theme==="dark";document.documentElement.dataset.theme=dark?"":"dark";localStorage.setItem("theme",dark?"light":"dark");renderCharts()};
    $("autoToggle").onclick=()=>{state.auto=!state.auto;$("autoToggle").classList.toggle("on",state.auto);$("autoToggle").setAttribute("aria-checked",state.auto);if(state.auto){state.timer=setInterval(loadData,REFRESH_MS)}else{clearInterval(state.timer)}};
    if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark";
  }
  document.addEventListener("DOMContentLoaded",()=>{bind();loadData(true);state.timer=setInterval(()=>state.auto&&loadData(false),REFRESH_MS)});
})();
