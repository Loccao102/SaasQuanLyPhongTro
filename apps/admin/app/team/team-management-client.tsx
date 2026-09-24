"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { StatusBadge } from "@propops/ui";
import { AdminShell } from "../../components/admin-shell";
import {
  adminTeamApi,
  type TeamOverview,
  type TeamRole,
  type TeamScopeInput
} from "../../lib/admin-team-api";

const roleOptions: TeamRole[] = [
  "OWNER",
  "ADMIN",
  "MANAGER",
  "STAFF",
  "ACCOUNTANT",
  "VIEWER"
];

function statusTone(status: string) {
  if (status === "ACTIVE") return "success" as const;
  if (status === "INVITED") return "warning" as const;
  return "neutral" as const;
}

function scopesFromForm(form: FormData, role: TeamRole): TeamScopeInput[] {
  const mode = String(form.get("scopeMode") ?? "ORGANIZATION");
  if (role === "OWNER" || mode === "ORGANIZATION") {
    return [{ type: "ORGANIZATION" }];
  }
  if (mode === "OPERATIONAL_GROUP") {
    return form.getAll("groupIds").map((value) => ({
      type: "OPERATIONAL_GROUP" as const,
      operationalGroupId: String(value)
    }));
  }
  return form.getAll("propertyIds").map((value) => ({
    type: "PROPERTY" as const,
    propertyId: String(value)
  }));
}

export function TeamManagementClient() {
  const [data, setData] = useState<TeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showGroup, setShowGroup] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await adminTeamApi.overview());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Không thể tải đội ngũ.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (mutation) {
      setError(mutation instanceof Error ? mutation.message : "Không thể cập nhật đội ngũ.");
    } finally {
      setSaving(false);
    }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = String(form.get("role")) as TeamRole;
    const scopes = scopesFromForm(form, role);
    if (scopes.length === 0) {
      setError("Hãy chọn ít nhất một phạm vi.");
      return;
    }
    await run(() =>
      adminTeamApi.invite({
        email: String(form.get("email") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        role,
        scopes
      })
    );
    setShowInvite(false);
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(() =>
      adminTeamApi.createGroup({
        code: String(form.get("code") ?? ""),
        name: String(form.get("name") ?? ""),
        propertyIds: form.getAll("propertyIds").map(String)
      })
    );
    setShowGroup(false);
  }

  if (loading || !data) {
    return (
      <AdminShell title="Đội ngũ & phân quyền" activeNav="Đội ngũ">
        {error ? <div className="admin-state admin-state--error">{error}</div> : <div className="admin-state">Đang tải membership và scope…</div>}
      </AdminShell>
    );
  }

  return (
    <AdminShell title="Đội ngũ & phân quyền" eyebrow="IDENTITY · MEMBERSHIP SCOPES" activeNav="Đội ngũ">
      {error ? (
        <div className="admin-state admin-state--error">
          <strong>Thao tác chưa hoàn tất.</strong>
          <span>{error}</span>
        </div>
      ) : null}

      <section className="asset-context">
        <div>
          <span className="eyebrow">ORGANIZATION MEMBERSHIP</span>
          <h2>{data.organization.name}</h2>
          <p>Role xác định được làm gì; scope xác định được làm ở toàn tổ chức, nhóm vận hành hay cơ sở nào.</p>
        </div>
        <div className="button-row">
          <button className="secondary-button" type="button" onClick={() => setShowGroup((value) => !value)}>+ Nhóm vận hành</button>
          <button className="primary-button" type="button" onClick={() => setShowInvite((value) => !value)}>+ Mời thành viên</button>
        </div>
      </section>

      {showInvite ? (
        <section className="panel">
          <div className="asset-section-heading"><div><span className="eyebrow">INVITE</span><h2>Thêm thành viên</h2></div></div>
          <form className="team-form" onSubmit={(event) => void invite(event)}>
            <label><span>Họ tên</span><input name="displayName" required /></label>
            <label><span>Email</span><input name="email" type="email" required /></label>
            <label>
              <span>Role</span>
              <select name="role" defaultValue="STAFF">
                {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            <label>
              <span>Kiểu phạm vi</span>
              <select name="scopeMode" defaultValue="PROPERTY">
                <option value="ORGANIZATION">Toàn tổ chức</option>
                <option value="OPERATIONAL_GROUP">Nhóm vận hành</option>
                <option value="PROPERTY">Cơ sở</option>
              </select>
            </label>
            <fieldset>
              <legend>Nhóm vận hành</legend>
              {data.groups.filter((group) => group.isActive).map((group) => (
                <label className="team-check" key={group.id}>
                  <input type="checkbox" name="groupIds" value={group.id} />
                  <span>{group.name} · {group.code}</span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Cơ sở</legend>
              {data.properties.filter((property) => property.isActive).map((property) => (
                <label className="team-check" key={property.id}>
                  <input type="checkbox" name="propertyIds" value={property.id} />
                  <span>{property.name} · {property.code}</span>
                </label>
              ))}
            </fieldset>
            <div className="button-row team-form__wide">
              <button className="primary-button" type="submit" disabled={saving}>Tạo lời mời</button>
            </div>
          </form>
          <p className="inline-note">Membership được tạo ở trạng thái INVITED. Việc gửi email/token mời sẽ được nối vào auth/session flow sau.</p>
        </section>
      ) : null}

      {showGroup ? (
        <section className="panel">
          <div className="asset-section-heading"><div><span className="eyebrow">OPERATIONAL GROUP</span><h2>Tạo nhóm vận hành</h2></div></div>
          <form className="team-form" onSubmit={(event) => void createGroup(event)}>
            <label><span>Mã nhóm</span><input name="code" required /></label>
            <label><span>Tên nhóm</span><input name="name" required /></label>
            <fieldset className="team-form__wide">
              <legend>Các cơ sở thuộc nhóm</legend>
              {data.properties.filter((property) => property.isActive).map((property) => (
                <label className="team-check" key={property.id}>
                  <input type="checkbox" name="propertyIds" value={property.id} />
                  <span>{property.name} · {property.code}</span>
                </label>
              ))}
            </fieldset>
            <div className="button-row team-form__wide">
              <button className="primary-button" type="submit" disabled={saving}>Tạo nhóm</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="team-layout">
        <div className="panel">
          <div className="asset-section-heading">
            <div><span className="eyebrow">MEMBERS</span><h2>{data.members.length} thành viên</h2></div>
          </div>
          <div className="team-member-list">
            {data.members.map((member) => (
              <MemberEditor
                key={member.id}
                member={member}
                data={data}
                saving={saving}
                onRun={run}
              />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="asset-section-heading">
            <div><span className="eyebrow">GROUPS</span><h2>Nhóm vận hành</h2></div>
          </div>
          <div className="team-group-list">
            {data.groups.length === 0 ? <div className="admin-state">Chưa có nhóm vận hành.</div> : data.groups.map((group) => (
              <GroupEditor key={group.id} group={group} data={data} saving={saving} onRun={run} />
            ))}
          </div>
        </div>
      </section>
    </AdminShell>
  );
}

function MemberEditor({
  member,
  data,
  saving,
  onRun
}: {
  member: TeamOverview["members"][number];
  data: TeamOverview;
  saving: boolean;
  onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const existingOrg = member.scopes.some((scope) => scope.type === "ORGANIZATION");
  const existingGroups = member.scopes.flatMap((scope) => scope.type === "OPERATIONAL_GROUP" ? [scope.operationalGroupId] : []);
  const existingProperties = member.scopes.flatMap((scope) => scope.type === "PROPERTY" ? [scope.propertyId] : []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const role = String(form.get("role")) as TeamRole;
    const scopes = scopesFromForm(form, role);
    if (scopes.length === 0) return;
    await onRun(() => adminTeamApi.updateMember(member.id, { role, scopes }));
    setEditing(false);
  }

  return (
    <article className="team-member-card">
      <div className="team-member-card__header">
        <div>
          <strong>{member.displayName}</strong>
          <span>{member.email}</span>
        </div>
        <div className="button-row">
          <StatusBadge tone={statusTone(member.status)}>{member.status}</StatusBadge>
          <StatusBadge tone={member.role === "OWNER" ? "info" : "neutral"}>{member.role}</StatusBadge>
        </div>
      </div>
      <div className="team-scope-pills">
        {member.scopes.map((scope, index) => <span key={scope.type + index}>{scope.label}</span>)}
      </div>
      {!editing ? (
        <div className="button-row">
          <button className="secondary-button secondary-button--compact" type="button" onClick={() => setEditing(true)}>Sửa quyền</button>
          {member.status !== "ACTIVE" ? (
            <button className="primary-button" type="button" disabled={saving} onClick={() => void onRun(() => adminTeamApi.activate(member.id))}>Kích hoạt</button>
          ) : member.id !== data.currentMembershipId ? (
            <button className="danger-button" type="button" disabled={saving} onClick={() => void onRun(() => adminTeamApi.suspend(member.id))}>Tạm khóa</button>
          ) : null}
        </div>
      ) : (
        <form className="team-inline-editor" onSubmit={(event) => void save(event)}>
          <label><span>Role</span><select name="role" defaultValue={member.role}>{roleOptions.map((role) => <option key={role}>{role}</option>)}</select></label>
          <label>
            <span>Kiểu phạm vi</span>
            <select name="scopeMode" defaultValue={existingOrg ? "ORGANIZATION" : existingGroups.length ? "OPERATIONAL_GROUP" : "PROPERTY"}>
              <option value="ORGANIZATION">Toàn tổ chức</option>
              <option value="OPERATIONAL_GROUP">Nhóm vận hành</option>
              <option value="PROPERTY">Cơ sở</option>
            </select>
          </label>
          <fieldset>
            <legend>Nhóm</legend>
            {data.groups.filter((group) => group.isActive).map((group) => <label className="team-check" key={group.id}><input type="checkbox" name="groupIds" value={group.id} defaultChecked={existingGroups.includes(group.id)} /><span>{group.name}</span></label>)}
          </fieldset>
          <fieldset>
            <legend>Cơ sở</legend>
            {data.properties.filter((property) => property.isActive).map((property) => <label className="team-check" key={property.id}><input type="checkbox" name="propertyIds" value={property.id} defaultChecked={existingProperties.includes(property.id)} /><span>{property.name}</span></label>)}
          </fieldset>
          <div className="button-row team-inline-editor__wide">
            <button className="secondary-button" type="button" onClick={() => setEditing(false)}>Hủy</button>
            <button className="primary-button" type="submit" disabled={saving}>Lưu quyền</button>
          </div>
        </form>
      )}
    </article>
  );
}

function GroupEditor({
  group,
  data,
  saving,
  onRun
}: {
  group: TeamOverview["groups"][number];
  data: TeamOverview;
  saving: boolean;
  onRun: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onRun(() => adminTeamApi.updateGroup(group.id, {
      code: String(form.get("code") ?? ""),
      name: String(form.get("name") ?? ""),
      propertyIds: form.getAll("propertyIds").map(String)
    }));
    setEditing(false);
  }

  return (
    <article className="team-group-card">
      <div>
        <strong>{group.name}</strong>
        <span>{group.code} · {group.propertyIds.length} cơ sở</span>
      </div>
      <StatusBadge tone={group.isActive ? "success" : "neutral"}>{group.isActive ? "ACTIVE" : "INACTIVE"}</StatusBadge>
      {group.isActive && !editing ? (
        <div className="button-row">
          <button className="secondary-button secondary-button--compact" type="button" onClick={() => setEditing(true)}>Sửa</button>
          <button className="danger-button" type="button" disabled={saving} onClick={() => void onRun(() => adminTeamApi.deactivateGroup(group.id))}>Deactivate</button>
        </div>
      ) : null}
      {editing ? (
        <form className="team-inline-editor team-inline-editor--group" onSubmit={(event) => void save(event)}>
          <label><span>Mã</span><input name="code" defaultValue={group.code} required /></label>
          <label><span>Tên</span><input name="name" defaultValue={group.name} required /></label>
          <fieldset className="team-inline-editor__wide">
            <legend>Cơ sở</legend>
            {data.properties.filter((property) => property.isActive).map((property) => <label className="team-check" key={property.id}><input type="checkbox" name="propertyIds" value={property.id} defaultChecked={group.propertyIds.includes(property.id)} /><span>{property.name}</span></label>)}
          </fieldset>
          <div className="button-row team-inline-editor__wide">
            <button className="secondary-button" type="button" onClick={() => setEditing(false)}>Hủy</button>
            <button className="primary-button" type="submit" disabled={saving}>Lưu nhóm</button>
          </div>
        </form>
      ) : null}
    </article>
  );
}
