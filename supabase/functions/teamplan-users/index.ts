import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Nicht angemeldet" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const admin = createClient(url, serviceKey);

    const { data: { user }, error: userErr } = await caller.auth.getUser();
    if (userErr || !user) return json({ error: "Ungültige Sitzung" }, 401);

    const body = await req.json();
    const teamId = String(body.teamId || "");
    const action = String(body.action || "list");

    const { data: membership, error: memErr } = await admin
      .from("team_members")
      .select("role,active")
      .eq("team_id", teamId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memErr || !membership || membership.role !== "admin" || membership.active !== true) {
      return json({ error: "Nur Admins dürfen Benutzer verwalten." }, 403);
    }

    if (action === "list") {
      const { data, error } = await admin
        .from("team_members")
        .select("team_id,user_id,employee_id,role,display_name,active,created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersErr) throw usersErr;

      const emails = new Map((usersData.users || []).map(u => [u.id, u.email || ""]));
      return json({ members: (data || []).map(m => ({ ...m, email: emails.get(m.user_id) || "" })) });
    }

    async function validateRoleEmployee(role: string, employeeId: string | null) {
      if (!["employee", "external"].includes(role)) return;
      if (!employeeId) throw new Error(role === "external" ? "Bitte eine externe Person zuordnen." : "Bitte einen Mitarbeiter zuordnen.");

      const { data: plan, error: planErr } = await admin
        .from("team_plans")
        .select("data")
        .eq("team_id", teamId)
        .maybeSingle();
      if (planErr) throw planErr;

      const employees = Array.isArray(plan?.data?.employees) ? plan.data.employees : [];
      const employee = employees.find((e: any) => String(e?.id || "") === employeeId);
      if (!employee) throw new Error("Die zugeordnete Person wurde im Team nicht gefunden.");

      const isExternal = employee.external === true;
      if (role === "external" && !isExternal) {
        throw new Error("Die Rolle Externer Projektmitarbeiter kann nur einer als extern markierten Person zugeordnet werden.");
      }
      if (role === "employee" && isExternal) {
        throw new Error("Eine externe Person kann nicht die interne Mitarbeiterrolle erhalten. Bitte Externer Projektmitarbeiter wählen.");
      }
    }

    if (action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const role = String(body.role || "employee");
      const employeeId = body.employeeId ? String(body.employeeId) : null;
      const displayName = String(body.displayName || "").trim();

      if (!email || !["admin", "planner", "employee", "viewer", "external"].includes(role)) {
        return json({ error: "Ungültige Eingaben" }, 400);
      }

      await validateRoleEmployee(role, employeeId);

      const { data: usersData, error: usersErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (usersErr) throw usersErr;

      let target = (usersData.users || []).find(u => (u.email || "").toLowerCase() === email);
      let inviteLink: string | undefined;

      if (!target || !target.confirmed_at) {
        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({ type: "invite", email });
        if (linkErr) throw linkErr;

        target = linkData.user;
        const actionLink = linkData.properties?.action_link;
        if (!actionLink) throw new Error("Einladungslink konnte nicht erzeugt werden.");

        const generated = new URL(actionLink);
        const tokenHash = generated.searchParams.get("token");
        const type = generated.searchParams.get("type") || "invite";
        if (!tokenHash) throw new Error("Einladungstoken fehlt.");

        inviteLink =
          "https://mrhenne.github.io/helios-teamplan/?token_hash=" +
          encodeURIComponent(tokenHash) +
          "&type=" +
          encodeURIComponent(type);
      }

      if (!target) throw new Error("Benutzer konnte nicht angelegt werden.");

      const { error: upsertErr } = await admin.from("team_members").upsert({
        team_id: teamId,
        user_id: target.id,
        employee_id: employeeId,
        role,
        display_name: displayName || email.split("@")[0],
        active: true
      }, { onConflict: "team_id,user_id" });

      if (upsertErr) throw upsertErr;
      return json({ ok: true, userId: target.id, delivery: inviteLink ? "link" : "existing", inviteLink });
    }

    if (action === "update") {
      const userId = String(body.userId || "");
      const role = String(body.role || "viewer");
      const employeeId = body.employeeId ? String(body.employeeId) : null;
      const displayName = String(body.displayName || "").trim();
      const active = body.active !== false;

      if (!userId || !["admin", "planner", "employee", "viewer", "external"].includes(role)) {
        return json({ error: "Ungültige Eingaben" }, 400);
      }

      await validateRoleEmployee(role, employeeId);

      if (userId === user.id && (!active || role !== "admin")) {
        return json({ error: "Du kannst deinen eigenen Admin-Zugang hier nicht deaktivieren oder herabstufen." }, 400);
      }

      const { error } = await admin
        .from("team_members")
        .update({ role, employee_id: employeeId, display_name: displayName, active })
        .eq("team_id", teamId)
        .eq("user_id", userId);

      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "delete") {
      const userId = String(body.userId || "");
      if (!userId) return json({ error: "Benutzer-ID fehlt" }, 400);
      if (userId === user.id) {
        return json({ error: "Du kannst deinen eigenen angemeldeten Admin-Account nicht löschen." }, 400);
      }

      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: "Unbekannte Aktion" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
