"use client";

import { useMemo, useState, type FormEvent } from "react";
import { MetricCard, ProgressBar, SectionHeader, StatusBadge } from "@propops/ui";

type View = "dashboard" | "settings" | "plans" | "organizations" | "jobs" | "logs" | "audit";
type Tone = "neutral" | "success" | "warning" | "danger" | "info";
type Setting = { key:string; group:"General"|"Billing"|"Automation"; label:string; description:string; type:"boolean"|"number"; value:boolean|number };
type Plan = { code:string; name:string; monthlyPriceVnd:number; roomLimit:number; staffLimit:number; automationQuota:number };
type Organization = { id:string; name:string; owner:string; planCode:string; subscriptionStatus:"ACTIVE"|"TRIALING"|"PAST_DUE"|"SUSPENDED"; rooms:number; staff:number; automationUsed:number };
type Job = { id:string; organizationId:string; kind:string; status:"SENT"|"RUNNING"|"RETRY"|"FAILED"|"NEEDS_ATTENTION"; attempts:number; error?:string };
type AuditEvent = { id:string; at:string; actor:string; action:string; target:string; detail:string; reason:string };
type ModalState = {kind:"setting";key:string}|{kind:"plan";code:string}|{kind:"retry";jobId:string}|null;

const navItems:Array<{id:View;label:string}> = [
  {id:"dashboard",label:"Tổng quan"},{id:"settings",label:"Cấu hình"},{id:"plans",label:"Gói & giới hạn"},
  {id:"organizations",label:"Organizations"},{id:"jobs",label:"Jobs / Queue"},{id:"logs",label:"Technical logs"},{id:"audit",label:"Audit log"}
];

const initialSettings:Setting[] = [
  {key:"registration_enabled",group:"General",label:"Cho phép đăng ký mới",description:"Bật/tắt signup SaaS.",type:"boolean",value:true},
  {key:"maintenance_mode",group:"General",label:"Maintenance mode",description:"Chuyển tenant surfaces sang maintenance policy.",type:"boolean",value:false},
  {key:"trial_days",group:"Billing",label:"Số ngày dùng thử",description:"Thời lượng trial mặc định.",type:"number",value:30},
  {key:"grace_period_days",group:"Billing",label:"Grace period",description:"Số ngày trước khi subscription chuyển read-only.",type:"number",value:7},
  {key:"notification_retry_limit",group:"Automation",label:"Notification retry limit",description:"Giới hạn retry tự động.",type:"number",value:3},
  {key:"playwright_provider_enabled",group:"Automation",label:"Playwright provider",description:"Edge provider chuyển tiếp cho Zalo.",type:"boolean",value:true}
];

const initialPlans:Plan[] = [
  {code:"STARTER",name:"Starter",monthlyPriceVnd:99000,roomLimit:20,staffLimit:2,automationQuota:500},
  {code:"GROWTH",name:"Growth",monthlyPriceVnd:249000,roomLimit:60,staffLimit:5,automationQuota:1000},
  {code:"PRO",name:"Pro",monthlyPriceVnd:499000,roomLimit:150,staffLimit:10,automationQuota:5000},
  {code:"BUSINESS",name:"Business",monthlyPriceVnd:799000,roomLimit:300,staffLimit:20,automationQuota:15000}
];

const organizations:Organization[] = [
  {id:"org_001",name:"Nhà trọ Minh Anh",owner:"Nguyễn Minh",planCode:"BUSINESS",subscriptionStatus:"ACTIVE",rooms:212,staff:8,automationUsed:1840},
  {id:"org_002",name:"Cụm trọ Thanh Xuân",owner:"Trần Lan",planCode:"GROWTH",subscriptionStatus:"PAST_DUE",rooms:58,staff:4,automationUsed:890},
  {id:"org_003",name:"HomeStay Đông Anh",owner:"Lê Hoàng",planCode:"PRO",subscriptionStatus:"ACTIVE",rooms:172,staff:7,automationUsed:2300},
  {id:"org_004",name:"Nhà trọ Hồng Hà",owner:"Phạm Hương",planCode:"STARTER",subscriptionStatus:"TRIALING",rooms:16,staff:1,automationUsed:46}
];

const initialJobs:Job[] = [
  {id:"job_901",organizationId:"org_001",kind:"ZALO_NOTIFICATION",status:"SENT",attempts:1},
  {id:"job_902",organizationId:"org_001",kind:"ZALO_NOTIFICATION",status:"NEEDS_ATTENTION",attempts:3,error:"SESSION_EXPIRED"},
  {id:"job_903",organizationId:"org_002",kind:"INVOICE_GENERATION",status:"FAILED",attempts:2,error:"VALIDATION_ERROR"},
  {id:"job_904",organizationId:"org_003",kind:"PAYMENT_WEBHOOK",status:"RETRY",attempts:1,error:"PROVIDER_TIMEOUT"},
  {id:"job_905",organizationId:"org_001",kind:"ZALO_NOTIFICATION",status:"RUNNING",attempts:1}
];

const technicalLogs = [
  {at:"01:26:12",level:"ERROR",service:"playwright-worker",message:"Zalo session expired; provider paused for account zalo_primary."},
  {at:"01:21:44",level:"WARN",service:"payment-worker",message:"Provider timeout; webhook event remains retryable."},
  {at:"01:18:03",level:"INFO",service:"api",message:"Health check OK · postgres 7ms · redis 2ms."},
  {at:"01:10:27",level:"WARN",service:"invoice-worker",message:"Job job_903 rejected by validation before financial commit."}
];

const initialAudit:AuditEvent[] = [
  {id:"aud_1",at:"2026-09-21 00:54",actor:"platform.admin",action:"PLAN_UPDATED",target:"PRO",detail:"room_limit 120 → 150",reason:"Pricing V1"},
  {id:"aud_2",at:"2026-09-21 00:41",actor:"ops.admin",action:"JOB_RETRY_REQUESTED",target:"job_904",detail:"Retry payment webhook",reason:"Transient provider timeout"}
];

function statusTone(status:string):Tone {
  if(["ACTIVE","TRIALING","SENT","INFO","ENABLED"].includes(status)) return "success";
  if(["PAST_DUE","RUNNING","RETRY","WARN","NEEDS_ATTENTION"].includes(status)) return "warning";
  if(["SUSPENDED","FAILED","ERROR","DISABLED"].includes(status)) return "danger";
  return "neutral";
}
function money(value:number){ return new Intl.NumberFormat("vi-VN").format(value)+"đ"; }

export default function CmsPage(){
  const [view,setView] = useState<View>("dashboard");
  const [settings,setSettings] = useState(initialSettings);
  const [plans,setPlans] = useState(initialPlans);
  const [jobs,setJobs] = useState(initialJobs);
  const [audit,setAudit] = useState(initialAudit);
  const [modal,setModal] = useState<ModalState>(null);

  const planByCode = useMemo(()=>new Map(plans.map(item=>[item.code,item])),[plans]);
  const orgById = useMemo(()=>new Map(organizations.map(item=>[item.id,item])),[]);
  const needsAttention = jobs.filter(job=>["FAILED","NEEDS_ATTENTION"].includes(job.status)).length;
  const overLimit = organizations.filter(org=>org.rooms>(planByCode.get(org.planCode)?.roomLimit??Number.POSITIVE_INFINITY)).length;

  function appendAudit(event:Omit<AuditEvent,"id"|"at"|"actor">){
    setAudit(current=>[{id:"aud_"+String(Date.now()),at:"2026-09-21 01:33",actor:"platform.admin",...event},...current]);
  }

  function submitModal(event:FormEvent<HTMLFormElement>){
    event.preventDefault();
    if(!modal) return;
    const data = new FormData(event.currentTarget);
    const reason = String(data.get("reason")??"").trim();
    if(reason.length<3) return;

    if(modal.kind==="setting"){
      const current=settings.find(item=>item.key===modal.key);
      if(!current) return;
      const raw=data.get("value");
      const nextValue=current.type==="boolean"?raw==="true":Number(raw);
      setSettings(items=>items.map(item=>item.key===current.key?{...item,value:nextValue}:item));
      appendAudit({action:"SYSTEM_SETTING_UPDATED",target:current.key,detail:String(current.value)+" → "+String(nextValue),reason});
    }
    if(modal.kind==="plan"){
      const current=plans.find(item=>item.code===modal.code);
      if(!current) return;
      const next:Plan={...current,monthlyPriceVnd:Number(data.get("monthlyPriceVnd")),roomLimit:Number(data.get("roomLimit")),staffLimit:Number(data.get("staffLimit")),automationQuota:Number(data.get("automationQuota"))};
      setPlans(items=>items.map(item=>item.code===current.code?next:item));
      appendAudit({action:"PLAN_CONFIG_UPDATED",target:current.code,detail:"price/limits updated",reason});
    }
    if(modal.kind==="retry"){
      const current=jobs.find(item=>item.id===modal.jobId);
      if(!current) return;
      setJobs(items=>items.map(item=>item.id===current.id?{...item,status:"RETRY",attempts:item.attempts+1}:item));
      appendAudit({action:"JOB_RETRY_REQUESTED",target:current.id,detail:current.status+" → RETRY",reason});
    }
    setModal(null);
  }

  return <div className="cms-shell">
    <aside className="cms-sidebar">
      <div className="cms-brand"><span className="cms-brand__mark">P</span><div><strong>PropOps</strong><span>Internal CMS</span></div></div>
      <nav className="cms-nav" aria-label="CMS navigation">
        {navItems.map(item=><button className={view===item.id?"cms-nav__item cms-nav__item--active":"cms-nav__item"} type="button" key={item.id} onClick={()=>setView(item.id)} aria-current={view===item.id?"page":undefined}><span className="cms-nav__dot" aria-hidden="true"/>{item.label}</button>)}
      </nav>
      <div className="cms-sidebar__footer"><span>Current principal</span><strong>PLATFORM_ADMIN</strong><small>Mock authorization · server enforcement pending</small></div>
    </aside>

    <main className="cms-main">
      <div className="cms-warning" role="note">Foundation slice dùng mock data. CMS không ghi DB trực tiếp; production mutations phải đi qua /api/cms/* và application/domain services.</div>
      <header className="cms-topbar"><div><span className="cms-eyebrow">INTERNAL SAAS OPERATIONS</span><h1>{navItems.find(item=>item.id===view)?.label}</h1></div><StatusBadge tone="info">PLATFORM_ADMIN</StatusBadge></header>

      <div className="cms-content">
        {view==="dashboard"&&<>
          <section className="cms-metrics" aria-label="CMS summary">
            <MetricCard label="Organizations" value={String(organizations.length)} detail="2 active · 1 trial · 1 past due" tone="info"/>
            <MetricCard label="Over limit" value={String(overLimit)} detail="Không xóa resource hiện hữu" tone={overLimit?"warning":"success"}/>
            <MetricCard label="Jobs cần xử lý" value={String(needsAttention)} detail="FAILED / NEEDS_ATTENTION" tone={needsAttention?"warning":"success"}/>
            <MetricCard label="System config" value={String(settings.length)} detail="Settings đang được quản lý" tone="neutral"/>
          </section>
          <section className="cms-grid">
            <article className="cms-panel"><SectionHeader title="Organizations cần chú ý"/><div className="cms-table-wrap"><table className="cms-table"><thead><tr><th>Organization</th><th>Subscription</th><th>Plan</th><th>Rooms</th></tr></thead><tbody>
              {organizations.filter(org=>org.subscriptionStatus!=="ACTIVE"||org.rooms>(planByCode.get(org.planCode)?.roomLimit??Infinity)).map(org=>{const p=planByCode.get(org.planCode);return <tr key={org.id}><td><strong>{org.name}</strong><small>{org.id}</small></td><td><StatusBadge tone={statusTone(org.subscriptionStatus)}>{org.subscriptionStatus}</StatusBadge></td><td>{org.planCode}</td><td>{org.rooms} / {p?.roomLimit??"—"}</td></tr>})}
            </tbody></table></div></article>
            <article className="cms-panel"><SectionHeader title="Worker health"/><div className="health-list"><div><span>API</span><StatusBadge tone="success">HEALTHY</StatusBadge></div><div><span>General worker</span><StatusBadge tone="success">HEALTHY</StatusBadge></div><div><span>Playwright worker</span><StatusBadge tone="warning">DEGRADED</StatusBadge></div><div><span>Redis queue</span><StatusBadge tone="success">HEALTHY</StatusBadge></div></div></article>
          </section>
        </>}

        {view==="settings"&&(["General","Billing","Automation"] as const).map(group=><section className="cms-panel" key={group}><SectionHeader title={group}/><div className="settings-list">
          {settings.filter(item=>item.group===group).map(item=><div className="setting-row" key={item.key}><div><strong>{item.label}</strong><small>{item.key}</small></div><div><span>{item.type==="boolean"?<StatusBadge tone={statusTone(item.value?"ENABLED":"DISABLED")}>{item.value?"ENABLED":"DISABLED"}</StatusBadge>:item.value}</span><small>{item.description}</small></div><button className="secondary-button" type="button" onClick={()=>setModal({kind:"setting",key:item.key})}>Chỉnh</button></div>)}
        </div></section>)}

        {view==="plans"&&<section className="cms-panel"><SectionHeader title="Pricing configuration" action={<span className="cms-note">Config data, không hard-code trong feature code.</span>}/><div className="cms-table-wrap"><table className="cms-table"><thead><tr><th>Plan</th><th>Monthly</th><th>Rooms</th><th>Staff</th><th>Automation</th><th/></tr></thead><tbody>
          {plans.map(p=><tr key={p.code}><td><strong>{p.name}</strong><small>{p.code}</small></td><td>{money(p.monthlyPriceVnd)}</td><td>{p.roomLimit}</td><td>{p.staffLimit}</td><td>{p.automationQuota.toLocaleString("vi-VN")}</td><td><button className="text-button" type="button" onClick={()=>setModal({kind:"plan",code:p.code})}>Chỉnh</button></td></tr>)}
        </tbody></table></div><p className="cms-callout">Production plan changes cần effective date / price version policy; không rewrite financial history.</p></section>}

        {view==="organizations"&&<section className="cms-panel"><SectionHeader title="Organization inspection" action={<span className="cms-note">Read/operate surface, không copy organization sang CMS DB.</span>}/><div className="cms-table-wrap"><table className="cms-table"><thead><tr><th>Organization</th><th>Plan</th><th>Status</th><th>Rooms</th><th>Staff</th><th>Automation</th></tr></thead><tbody>
          {organizations.map(org=>{const p=planByCode.get(org.planCode);const over=org.rooms>(p?.roomLimit??Infinity);return <tr key={org.id}><td><strong>{org.name}</strong><small>{org.owner} · {org.id}</small></td><td>{org.planCode}</td><td><StatusBadge tone={statusTone(org.subscriptionStatus)}>{org.subscriptionStatus}</StatusBadge></td><td className={over?"danger-text":undefined}>{org.rooms} / {p?.roomLimit??"—"}</td><td>{org.staff} / {p?.staffLimit??"—"}</td><td className="usage-cell"><ProgressBar value={org.automationUsed} max={p?.automationQuota??1} label={org.automationUsed.toLocaleString("vi-VN")+" / "+(p?.automationQuota??0).toLocaleString("vi-VN")}/></td></tr>})}
        </tbody></table></div></section>}

        {view==="jobs"&&<section className="cms-panel"><SectionHeader title="Operational jobs" action={<span className="cms-note">UNKNOWN không bao giờ được coi là success.</span>}/><div className="cms-table-wrap"><table className="cms-table"><thead><tr><th>Job</th><th>Organization</th><th>Kind</th><th>Status</th><th>Attempts</th><th>Last error</th><th/></tr></thead><tbody>
          {jobs.map(job=>{const retryable=["FAILED","RETRY","NEEDS_ATTENTION"].includes(job.status);return <tr key={job.id}><td><strong>{job.id}</strong></td><td>{orgById.get(job.organizationId)?.name??job.organizationId}</td><td>{job.kind}</td><td><StatusBadge tone={statusTone(job.status)}>{job.status}</StatusBadge></td><td>{job.attempts}</td><td>{job.error??"—"}</td><td><button className="text-button" type="button" disabled={!retryable} onClick={()=>setModal({kind:"retry",jobId:job.id})}>Retry</button></td></tr>})}
        </tbody></table></div></section>}

        {view==="logs"&&<section className="cms-panel"><SectionHeader title="Technical logs" action={<span className="cms-note">Future source: Loki / observability API.</span>}/><div className="log-list">
          {technicalLogs.map(log=><div className="log-row" key={log.at+log.service}><code>{log.at}</code><StatusBadge tone={statusTone(log.level)}>{log.level}</StatusBadge><strong>{log.service}</strong><span>{log.message}</span></div>)}
        </div></section>}

        {view==="audit"&&<section className="cms-panel"><SectionHeader title="Platform audit" action={<span className="cms-note">Read-only.</span>}/><div className="audit-list">
          {audit.map(item=><article className="audit-item" key={item.id}><div><strong>{item.action}</strong><StatusBadge>{item.target}</StatusBadge></div><p>{item.detail}</p><small>{item.at} · {item.actor} · Reason: {item.reason}</small></article>)}
        </div></section>}
      </div>
    </main>

    {modal&&<div className="modal-backdrop" role="presentation" onMouseDown={event=>{if(event.currentTarget===event.target)setModal(null)}}><form className="cms-modal" role="dialog" aria-modal="true" onSubmit={submitModal}>
      {modal.kind==="setting"&&(()=>{const item=settings.find(x=>x.key===modal.key);if(!item)return null;return <><h2>Chỉnh {item.label}</h2><p className="modal-warning">System setting có thể ảnh hưởng toàn bộ SaaS. Backend production phải validate + audit.</p><label>Giá trị{item.type==="boolean"?<select name="value" defaultValue={String(item.value)}><option value="true">Enabled</option><option value="false">Disabled</option></select>:<input name="value" type="number" min={0} defaultValue={Number(item.value)} required/>}</label></>})()}
      {modal.kind==="plan"&&(()=>{const item=plans.find(x=>x.code===modal.code);if(!item)return null;return <><h2>Chỉnh {item.name}</h2><p className="modal-warning">Prototype cập nhật local state. Production phải áp dụng price/version/effective-date policy.</p><label>Giá/tháng (VND)<input name="monthlyPriceVnd" type="number" min={0} step={1000} defaultValue={item.monthlyPriceVnd} required/></label><label>Room limit<input name="roomLimit" type="number" min={1} defaultValue={item.roomLimit} required/></label><label>Staff limit<input name="staffLimit" type="number" min={1} defaultValue={item.staffLimit} required/></label><label>Automation quota<input name="automationQuota" type="number" min={0} defaultValue={item.automationQuota} required/></label></>})()}
      {modal.kind==="retry"&&<><h2>Queue manual retry</h2><p className="modal-warning">Retry phải idempotent và chỉ áp dụng cho trạng thái retryable.</p></>}
      <label>Lý do<textarea name="reason" minLength={3} required placeholder="Ghi lý do để audit..."/></label>
      <div className="modal-actions"><button className="secondary-button" type="button" onClick={()=>setModal(null)}>Hủy</button><button className="primary-button" type="submit">Xác nhận thay đổi</button></div>
    </form></div>}
  </div>;
}
