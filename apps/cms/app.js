(() => {
"use strict";

const KEY = "propops-cms-prototype-v1";
const seed = {
  settings: [
    {key:"registration_enabled",group:"General",label:"Cho phép đăng ký mới",description:"Bật/tắt signup SaaS.",type:"boolean",value:true},
    {key:"maintenance_mode",group:"General",label:"Maintenance mode",description:"Chuyển tenant surfaces sang chế độ bảo trì.",type:"boolean",value:false},
    {key:"trial_days",group:"Billing",label:"Số ngày dùng thử",description:"Thời lượng trial mặc định.",type:"number",value:30},
    {key:"grace_period_days",group:"Billing",label:"Grace period",description:"Số ngày gia hạn trước read-only.",type:"number",value:7},
    {key:"notification_retry_limit",group:"Automation",label:"Notification retry limit",description:"Giới hạn retry tự động.",type:"number",value:3},
    {key:"playwright_provider_enabled",group:"Automation",label:"Playwright provider",description:"Edge provider chuyển tiếp cho Zalo.",type:"boolean",value:true}
  ],
  plans: [
    {code:"STARTER",name:"Starter",monthly:99000,roomLimit:20,staffLimit:2,automationQuota:500,active:true},
    {code:"GROWTH",name:"Growth",monthly:249000,roomLimit:60,staffLimit:5,automationQuota:1000,active:true},
    {code:"PRO",name:"Pro",monthly:499000,roomLimit:150,staffLimit:10,automationQuota:5000,active:true},
    {code:"BUSINESS",name:"Business",monthly:799000,roomLimit:300,staffLimit:20,automationQuota:15000,active:true}
  ],
  organizations: [
    {id:"org_001",name:"Nhà trọ Minh Anh",owner:"Nguyễn Minh",plan:"BUSINESS",subscription:"ACTIVE",rooms:212,staff:8,automationUsed:1840,periodEnd:"2026-10-01"},
    {id:"org_002",name:"Cụm trọ Thanh Xuân",owner:"Trần Lan",plan:"GROWTH",subscription:"PAST_DUE",rooms:58,staff:4,automationUsed:890,periodEnd:"2026-09-18"},
    {id:"org_003",name:"HomeStay Đông Anh",owner:"Lê Hoàng",plan:"PRO",subscription:"ACTIVE",rooms:172,staff:7,automationUsed:2300,periodEnd:"2026-10-12"},
    {id:"org_004",name:"Nhà trọ Hồng Hà",owner:"Phạm Hương",plan:"STARTER",subscription:"TRIALING",rooms:16,staff:1,automationUsed:46,periodEnd:"2026-10-05"}
  ],
  jobs: [
    {id:"job_901",organizationId:"org_001",kind:"ZALO_NOTIFICATION",status:"SENT",attempts:1,error:""},
    {id:"job_902",organizationId:"org_001",kind:"ZALO_NOTIFICATION",status:"NEEDS_ATTENTION",attempts:3,error:"SESSION_EXPIRED"},
    {id:"job_903",organizationId:"org_002",kind:"INVOICE_GENERATION",status:"FAILED",attempts:2,error:"VALIDATION_ERROR"},
    {id:"job_904",organizationId:"org_003",kind:"PAYMENT_WEBHOOK",status:"RETRY",attempts:1,error:"PROVIDER_TIMEOUT"},
    {id:"job_905",organizationId:"org_001",kind:"ZALO_NOTIFICATION",status:"RUNNING",attempts:1,error:""}
  ],
  audit: [
    {id:"aud_1",at:"2026-09-21T00:54:00+07:00",actor:"platform.admin",action:"PLAN_UPDATED",target:"PRO",detail:"room_limit 120 → 150",reason:"Pricing V1"},
    {id:"aud_2",at:"2026-09-21T00:41:00+07:00",actor:"ops.admin",action:"JOB_RETRY_REQUESTED",target:"job_904",detail:"Retry payment webhook",reason:"Transient provider timeout"}
  ]
};

const clone = x => JSON.parse(JSON.stringify(x));
let state = load();
let route = location.hash.slice(1) || "dashboard";
let selectedOrg = null;

const navItems = [
  ["dashboard","Tổng quan"],
  ["settings","Cấu hình"],
  ["plans","Gói & giới hạn"],
  ["organizations","Organizations"],
  ["jobs","Jobs / Queue"],
  ["audit","Audit log"]
];

const $ = sel => document.querySelector(sel);
const money = n => n == null ? "Custom" : new Intl.NumberFormat("vi-VN").format(n) + " ₫";
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
const fmtDate = v => new Intl.DateTimeFormat("vi-VN",{dateStyle:"medium"}).format(new Date(v));
const fmtDateTime = v => new Intl.DateTimeFormat("vi-VN",{dateStyle:"short",timeStyle:"short"}).format(new Date(v));

function load(){
  try { return JSON.parse(localStorage.getItem(KEY)) || clone(seed); }
  catch { return clone(seed); }
}
function persist(){ localStorage.setItem(KEY, JSON.stringify(state)); }
function audit(action,target,detail,reason){
  state.audit.unshift({id:"aud_"+Date.now(),at:new Date().toISOString(),actor:"platform.admin",action,target,detail,reason});
  persist();
}
function statusBadge(status){
  const tone = ["ACTIVE","SENT","SUCCESS","TRIALING"].includes(status) ? "success"
    : ["PAST_DUE","RETRY","NEEDS_ATTENTION","RUNNING"].includes(status) ? "warning"
    : ["FAILED","SUSPENDED"].includes(status) ? "danger" : "info";
  return '<span class="badge '+tone+'">'+esc(status)+'</span>';
}
function plan(code){ return state.plans.find(p => p.code === code); }
function orgName(id){ return state.organizations.find(o => o.id === id)?.name || id; }
function usageBar(current,limit){
  if(limit == null) return '<span class="muted">Custom</span>';
  const pct = Math.min(100, Math.round(current / Math.max(limit,1) * 100));
  const over = current > limit;
  return '<div><strong>' + current + ' / ' + limit + '</strong><div class="progress '+(over?'over':'')+'"><span style="width:'+pct+'%"></span></div></div>';
}
function toast(msg){
  const root = $("#toast-root");
  root.innerHTML = '<div class="toast">'+esc(msg)+'</div>';
  setTimeout(()=>root.innerHTML="",2600);
}
function setRoute(next){
  route = next; selectedOrg = null; location.hash = next; render();
}
function renderNav(){
  $("#nav").innerHTML = navItems.map(([id,label]) =>
    '<button class="nav-btn '+(route===id?'active':'')+'" data-route="'+id+'" type="button">'+label+'</button>'
  ).join("");
  document.querySelectorAll("[data-route]").forEach(b => b.onclick = () => setRoute(b.dataset.route));
}
function render(){
  renderNav();
  const titles = Object.fromEntries(navItems);
  $("#title").textContent = titles[route] || "CMS";
  $("#clock").textContent = new Intl.DateTimeFormat("vi-VN",{dateStyle:"medium",timeStyle:"short"}).format(new Date());
  const views = {dashboard,settings,plans,organizations,jobs,auditLog};
  $("#content").innerHTML = (views[route] || dashboard)();
  bind();
}
function dashboard(){
  const active = state.organizations.filter(o=>o.subscription==="ACTIVE").length;
  const overdue = state.organizations.filter(o=>o.subscription==="PAST_DUE").length;
  const failed = state.jobs.filter(j=>["FAILED","NEEDS_ATTENTION"].includes(j.status)).length;
  const overLimit = state.organizations.filter(o=>{const p=plan(o.plan);return p && o.rooms>p.roomLimit}).length;
  return `
    <div class="grid metrics">
      <article class="card"><div class="metric-label">Organizations</div><div class="metric-value">${state.organizations.length}</div><div class="metric-note">${active} active subscriptions</div></article>
      <article class="card"><div class="metric-label">Past due</div><div class="metric-value">${overdue}</div><div class="metric-note">cần theo dõi billing</div></article>
      <article class="card"><div class="metric-label">Over limit</div><div class="metric-value">${overLimit}</div><div class="metric-note">không xóa resource hiện hữu</div></article>
      <article class="card"><div class="metric-label">Jobs cần chú ý</div><div class="metric-value">${failed}</div><div class="metric-note">FAILED / NEEDS_ATTENTION</div></article>
    </div>
    <div class="section-head"><h2>Organization cần chú ý</h2></div>
    ${organizationTable(state.organizations.filter(o=>o.subscription!=="ACTIVE" || o.rooms>(plan(o.plan)?.roomLimit??Infinity)).slice(0,5))}
    <div class="section-head"><h2>Job gần đây</h2></div>
    ${jobsTable(state.jobs.slice(0,5))}
  `;
}
function settings(){
  const groups = [...new Set(state.settings.map(s=>s.group))];
  return groups.map(group => `
    <div class="section-head"><h2>${esc(group)}</h2></div>
    <div class="card setting-list">
      ${state.settings.filter(s=>s.group===group).map(s=>`
        <div class="setting-row">
          <div><strong>${esc(s.label)}</strong><small>${esc(s.key)}</small></div>
          <div><span>${s.type==="boolean" ? statusBadge(s.value?"ENABLED":"DISABLED") : esc(s.value)}</span><small>${esc(s.description)}</small></div>
          <button class="btn" data-edit-setting="${esc(s.key)}" type="button">Chỉnh</button>
        </div>`).join("")}
    </div>`).join("");
}
function plans(){
  return `
    <div class="section-head"><h2>Pricing configuration</h2><span class="muted">Giá/limit là data, không hard-code.</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Gói</th><th>Giá/tháng</th><th>Phòng</th><th>Staff</th><th>Automation</th><th></th></tr></thead>
      <tbody>${state.plans.map(p=>`<tr>
        <td><strong>${esc(p.name)}</strong><div class="muted">${esc(p.code)}</div></td>
        <td>${money(p.monthly)}</td><td>${p.roomLimit}</td><td>${p.staffLimit}</td><td>${p.automationQuota}</td>
        <td><button class="row-btn" data-edit-plan="${p.code}" type="button">Chỉnh cấu hình</button></td>
      </tr>`).join("")}</tbody>
    </table></div>
    <div class="callout" style="margin-top:14px">Thay đổi plan trong CMS phải đi qua backend service và audit. Production không được ghi thẳng DB.</div>
  `;
}
function organizationTable(rows){
  if(!rows.length) return '<div class="card empty">Không có organization phù hợp.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Organization</th><th>Gói</th><th>Subscription</th><th>Phòng</th><th>Kỳ hiện tại</th><th></th></tr></thead>
    <tbody>${rows.map(o=>{const p=plan(o.plan);return `<tr>
      <td><strong>${esc(o.name)}</strong><div class="muted">${esc(o.owner)} · ${esc(o.id)}</div></td>
      <td>${esc(o.plan)}</td><td>${statusBadge(o.subscription)}</td><td>${usageBar(o.rooms,p?.roomLimit)}</td><td>${fmtDate(o.periodEnd)}</td>
      <td><button class="row-btn" data-org="${o.id}" type="button">Xem</button></td>
    </tr>`}).join("")}</tbody>
  </table></div>`;
}
function organizations(){
  if(selectedOrg){
    const o=state.organizations.find(x=>x.id===selectedOrg);
    if(!o) selectedOrg=null; else return organizationDetail(o);
  }
  return `
    <div class="section-head">
      <h2>Organization inspection</h2>
      <div class="toolbar"><input id="org-search" type="search" placeholder="Tên, chủ trọ, org id..."><select id="org-filter"><option value="">Tất cả trạng thái</option><option>ACTIVE</option><option>TRIALING</option><option>PAST_DUE</option><option>SUSPENDED</option></select></div>
    </div>
    <div id="org-table">${organizationTable(state.organizations)}</div>
  `;
}
function organizationDetail(o){
  const p=plan(o.plan); const over=o.rooms>(p?.roomLimit??Infinity);
  return `
    <div class="actions" style="margin-bottom:14px"><button class="btn" id="back-orgs" type="button">← Danh sách</button></div>
    <div class="split">
      <article class="card">
        <p class="eyebrow">${esc(o.id)}</p><h2>${esc(o.name)}</h2><p class="muted">Chủ tài khoản: ${esc(o.owner)}</p>
        ${over?'<div class="callout">Organization đang vượt room limit. Không xóa phòng; SaaS chỉ chặn tăng resource theo policy.</div>':""}
        <div class="section-head"><h3>Usage</h3></div>
        <div class="detail">
          <div class="detail-row"><span>Phòng</span><span>${usageBar(o.rooms,p?.roomLimit)}</span></div>
          <div class="detail-row"><span>Staff</span><span>${usageBar(o.staff,p?.staffLimit)}</span></div>
          <div class="detail-row"><span>Automation tháng</span><span>${usageBar(o.automationUsed,p?.automationQuota)}</span></div>
        </div>
      </article>
      <aside class="card">
        <h3>Subscription</h3>
        <div class="detail">
          <div class="detail-row"><span>Plan</span><strong>${esc(o.plan)}</strong></div>
          <div class="detail-row"><span>Status</span>${statusBadge(o.subscription)}</div>
          <div class="detail-row"><span>Period end</span><strong>${fmtDate(o.periodEnd)}</strong></div>
        </div>
        <div class="actions" style="margin-top:16px">
          <button class="btn primary" data-change-plan="${o.id}" type="button">Đổi gói</button>
          <button class="btn ${o.subscription==="SUSPENDED"?"":"danger"}" data-toggle-subscription="${o.id}" type="button">${o.subscription==="SUSPENDED"?"Reactivate":"Suspend"}</button>
        </div>
      </aside>
    </div>
  `;
}
function jobsTable(rows){
  if(!rows.length) return '<div class="card empty">Không có job.</div>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>Job</th><th>Organization</th><th>Loại</th><th>Trạng thái</th><th>Attempts</th><th>Error</th><th></th></tr></thead>
    <tbody>${rows.map(j=>`<tr>
      <td><strong>${esc(j.id)}</strong></td><td>${esc(orgName(j.organizationId))}</td><td>${esc(j.kind)}</td><td>${statusBadge(j.status)}</td><td>${j.attempts}</td><td>${esc(j.error||"—")}</td>
      <td><button class="row-btn" data-retry-job="${j.id}" type="button" ${["FAILED","RETRY","NEEDS_ATTENTION"].includes(j.status)?"":"disabled"}>Retry</button></td>
    </tr>`).join("")}</tbody>
  </table></div>`;
}
function jobs(){
  return `<div class="section-head"><h2>Operational jobs</h2><span class="muted">UNKNOWN không bao giờ được coi là success.</span></div>${jobsTable(state.jobs)}`;
}
function auditLog(){
  return `
    <div class="section-head"><h2>Platform audit</h2><span class="muted">Mock audit trail của các action CMS.</span></div>
    <div class="card audit">${state.audit.length?state.audit.map(a=>`<div class="audit-item"><strong>${esc(a.action)} · ${esc(a.target)}</strong><p>${esc(a.detail)} · Reason: ${esc(a.reason)}</p><time>${fmtDateTime(a.at)} · ${esc(a.actor)}</time></div>`).join(""):'<div class="empty">Chưa có audit event.</div>'}</div>
  `;
}
function openModal({title,body,onSubmit,submitLabel="Xác nhận",danger=false}){
  $("#modal-root").innerHTML = `<div class="modal-backdrop"><form class="modal" id="modal-form" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h2>${esc(title)}</h2>${body}<div class="modal-actions"><button class="btn" id="modal-cancel" type="button">Hủy</button><button class="btn ${danger?"danger":"primary"}" type="submit">${esc(submitLabel)}</button></div>
  </form></div>`;
  $("#modal-cancel").onclick=closeModal;
  $(".modal-backdrop").onclick=e=>{if(e.target.classList.contains("modal-backdrop"))closeModal()};
  $("#modal-form").onsubmit=e=>{e.preventDefault();onSubmit(new FormData(e.currentTarget));};
  document.addEventListener("keydown",escapeModal,{once:true});
}
function escapeModal(e){ if(e.key==="Escape") closeModal(); }
function closeModal(){ $("#modal-root").innerHTML=""; }
function editSetting(key){
  const s=state.settings.find(x=>x.key===key);
  const control=s.type==="boolean"
    ? `<select name="value"><option value="true" ${s.value===true?"selected":""}>Enabled</option><option value="false" ${s.value===false?"selected":""}>Disabled</option></select>`
    : `<input name="value" type="number" min="0" value="${esc(s.value)}" required>`;
  openModal({title:"Chỉnh "+s.label,body:`<div class="consequence">Thay đổi system setting có thể ảnh hưởng toàn bộ SaaS. Production phải validate + audit server-side.</div><div class="form-grid"><label>Giá trị${control}</label><label>Lý do<textarea name="reason" required minlength="3"></textarea></label></div>`,submitLabel:"Lưu cấu hình",onSubmit:fd=>{
    const before=s.value; s.value=s.type==="boolean"?fd.get("value")==="true":Number(fd.get("value"));
    audit("SYSTEM_SETTING_UPDATED",s.key,String(before)+" → "+String(s.value),fd.get("reason")); closeModal(); render(); toast("Đã cập nhật mock setting");
  }});
}
function editPlan(code){
  const p=plan(code);
  openModal({title:"Chỉnh "+p.name,body:`<div class="consequence">Plan config là SaaS configuration. Không được rewrite dữ liệu lịch sử hoặc bypass subscription policy.</div><div class="form-grid">
    <label>Giá/tháng (VND)<input name="monthly" type="number" min="0" step="1000" value="${p.monthly}" required></label>
    <label>Room limit<input name="roomLimit" type="number" min="1" value="${p.roomLimit}" required></label>
    <label>Staff limit<input name="staffLimit" type="number" min="1" value="${p.staffLimit}" required></label>
    <label>Automation quota<input name="automationQuota" type="number" min="0" value="${p.automationQuota}" required></label>
    <label>Lý do<textarea name="reason" required minlength="3"></textarea></label>
  </div>`,submitLabel:"Lưu plan config",onSubmit:fd=>{
    const before=JSON.stringify({monthly:p.monthly,roomLimit:p.roomLimit,staffLimit:p.staffLimit,automationQuota:p.automationQuota});
    p.monthly=Number(fd.get("monthly"));p.roomLimit=Number(fd.get("roomLimit"));p.staffLimit=Number(fd.get("staffLimit"));p.automationQuota=Number(fd.get("automationQuota"));
    audit("PLAN_CONFIG_UPDATED",p.code,before+" → "+JSON.stringify({monthly:p.monthly,roomLimit:p.roomLimit,staffLimit:p.staffLimit,automationQuota:p.automationQuota}),fd.get("reason"));
    closeModal();render();toast("Đã cập nhật mock plan");
  }});
}
function changePlan(orgId){
  const o=state.organizations.find(x=>x.id===orgId);
  openModal({title:"Đổi gói cho "+o.name,body:`<div class="consequence">Prototype áp dụng ngay. Production phải hỗ trợ effective date, price version và không tự động charge/up-plan âm thầm.</div><div class="form-grid">
    <label>Gói mới<select name="plan">${state.plans.map(p=>`<option value="${p.code}" ${p.code===o.plan?"selected":""}>${p.name} — ${money(p.monthly)}</option>`).join("")}</select></label>
    <label>Lý do<textarea name="reason" required minlength="3"></textarea></label>
  </div>`,submitLabel:"Đổi gói",onSubmit:fd=>{
    const before=o.plan;o.plan=fd.get("plan");audit("SUBSCRIPTION_PLAN_CHANGED",o.id,before+" → "+o.plan,fd.get("reason"));closeModal();render();toast("Đã đổi mock plan");
  }});
}
function toggleSubscription(orgId){
  const o=state.organizations.find(x=>x.id===orgId); const suspend=o.subscription!=="SUSPENDED";
  openModal({title:(suspend?"Suspend ":"Reactivate ")+o.name,body:`<div class="consequence">${suspend?"Tenant surface có thể chuyển read-only theo policy; không xóa dữ liệu.":"Khôi phục quyền sử dụng theo subscription/entitlement hiện tại."}</div><div class="form-grid"><label>Lý do<textarea name="reason" required minlength="3"></textarea></label></div>`,submitLabel:suspend?"Suspend":"Reactivate",danger:suspend,onSubmit:fd=>{
    const before=o.subscription;o.subscription=suspend?"SUSPENDED":"ACTIVE";audit(suspend?"SUBSCRIPTION_SUSPENDED":"SUBSCRIPTION_REACTIVATED",o.id,before+" → "+o.subscription,fd.get("reason"));closeModal();render();toast("Đã cập nhật mock subscription");
  }});
}
function retryJob(jobId){
  const j=state.jobs.find(x=>x.id===jobId);
  openModal({title:"Retry "+j.id,body:`<div class="consequence">Retry phải idempotent. Provider failure không được làm corrupt core state.</div><div class="form-grid"><label>Lý do<textarea name="reason" required minlength="3"></textarea></label></div>`,submitLabel:"Queue retry",onSubmit:fd=>{
    const before=j.status;j.status="RETRY";j.attempts+=1;audit("JOB_RETRY_REQUESTED",j.id,before+" → RETRY",fd.get("reason"));closeModal();render();toast("Đã queue mock retry");
  }});
}
function bind(){
  document.querySelectorAll("[data-edit-setting]").forEach(b=>b.onclick=()=>editSetting(b.dataset.editSetting));
  document.querySelectorAll("[data-edit-plan]").forEach(b=>b.onclick=()=>editPlan(b.dataset.editPlan));
  document.querySelectorAll("[data-org]").forEach(b=>b.onclick=()=>{selectedOrg=b.dataset.org;render()});
  document.querySelectorAll("[data-change-plan]").forEach(b=>b.onclick=()=>changePlan(b.dataset.changePlan));
  document.querySelectorAll("[data-toggle-subscription]").forEach(b=>b.onclick=()=>toggleSubscription(b.dataset.toggleSubscription));
  document.querySelectorAll("[data-retry-job]").forEach(b=>b.onclick=()=>retryJob(b.dataset.retryJob));
  if($("#back-orgs")) $("#back-orgs").onclick=()=>{selectedOrg=null;render()};
  if($("#org-search")){
    const refresh=()=>{const q=$("#org-search").value.trim().toLowerCase(),f=$("#org-filter").value;const rows=state.organizations.filter(o=>(!q||[o.name,o.owner,o.id].some(x=>x.toLowerCase().includes(q)))&&(!f||o.subscription===f));$("#org-table").innerHTML=organizationTable(rows);document.querySelectorAll("[data-org]").forEach(b=>b.onclick=()=>{selectedOrg=b.dataset.org;render()});};
    $("#org-search").oninput=refresh;$("#org-filter").onchange=refresh;
  }
}
$("#reset").onclick=()=>{state=clone(seed);persist();selectedOrg=null;render();toast("Đã reset mock data")};
window.addEventListener("hashchange",()=>{route=location.hash.slice(1)||"dashboard";selectedOrg=null;render()});
render();
})();
