import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://proideacodestudio.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders });

const constantTimeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in to manage device notifications." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:Proidea2025@gmail.com";
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Notification service configuration is incomplete." }, 503);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request body." }, 400); }
  const action = String(body.action || "");
  const dispatchSecret = Deno.env.get("CLARIVA_DISPATCH_SECRET") || "";
  const suppliedDispatchSecret = req.headers.get("x-clariva-dispatch-secret") || "";
  const isServiceDispatch = action === "dispatch_pending"
    && constantTimeEqual(suppliedDispatchSecret, dispatchSecret)
    && dispatchSecret.length >= 32;

  let userId: string | null = null;
  if (action === "dispatch_pending") {
    if (!dispatchSecret || dispatchSecret.length < 32) return json({ error: "Server dispatch is not configured." }, 503);
    if (!isServiceDispatch) return json({ error: "Service authorization is required." }, 403);
  } else {
    if (!token) return json({ error: "Sign in to manage device notifications." }, 401);
    const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Sign in again." }, 401);
    userId = authData.user.id;
  }

  if (action === "dispatch_pending") {
    if (!vapidPublic || !vapidPrivate) return json({ error: "The notification delivery keys have not been configured yet." }, 503);
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

    const { data: pending, error: claimError } = await admin.rpc("claim_clariva_push_notifications", { p_limit: 200 });
    if (claimError) {
      console.error("Pending notification claim failed:", claimError);
      return json({ error: "Unable to claim pending notifications." }, 500);
    }
    if (!pending?.length) return json({ ok: true, claimed: 0, sent: 0, failed: 0, noSubscription: 0, removedExpired: 0 });

    const targetIds = [...new Set((pending as Array<{ user_id: string }>).map(row => row.user_id))];
    const subscriptions: Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }> = [];
    for (let offset = 0; offset < targetIds.length; offset += 500) {
      const { data, error } = await admin.from("push_subscriptions")
        .select("id,user_id,endpoint,p256dh,auth")
        .in("user_id", targetIds.slice(offset, offset + 500));
      if (error) return json({ error: "Unable to retrieve push subscriptions." }, 500);
      subscriptions.push(...(data || []));
    }

    const subscriptionsByUser = new Map<string, typeof subscriptions>();
    for (const sub of subscriptions) {
      const list = subscriptionsByUser.get(sub.user_id) || [];
      list.push(sub);
      subscriptionsByUser.set(sub.user_id, list);
    }

    const sentNotificationIds = new Set<string>();
    const expiredSubscriptionIds: string[] = [];
    let sent = 0;
    let failed = 0;
    let noSubscription = 0;

    const deliveryTasks = (pending as Array<{
      notification_id: string; user_id: string; title: string; message: string; destination: string;
    }>).flatMap(notification => {
      const userSubscriptions = subscriptionsByUser.get(notification.user_id) || [];
      if (!userSubscriptions.length) {
        noSubscription++;
        return [];
      }
      return userSubscriptions.map(subscription => ({ notification, subscription }));
    });

    for (let offset = 0; offset < deliveryTasks.length; offset += 40) {
      const batch = deliveryTasks.slice(offset, offset + 40);
      await Promise.all(batch.map(async ({ notification, subscription }) => {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth }
          }, JSON.stringify({
            title: notification.title,
            body: notification.message,
            url: notification.destination,
            tag: ("clariva-event-" + notification.notification_id).slice(0, 80)
          }), { TTL: 60 * 60 * 24 });
          sent++;
          sentNotificationIds.add(notification.notification_id);
        } catch (error) {
          failed++;
          const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
          if (statusCode === 404 || statusCode === 410) expiredSubscriptionIds.push(subscription.id);
          else console.error("Automatic event push failed:", statusCode, error);
        }
      }));
    }

    if (expiredSubscriptionIds.length) {
      await admin.from("push_subscriptions").delete().in("id", [...new Set(expiredSubscriptionIds)]);
    }
    if (sentNotificationIds.size) {
      const { error: markError } = await admin.from("notifications")
        .update({ push_sent_at: new Date().toISOString() })
        .in("id", [...sentNotificationIds]);
      if (markError) console.error("Automatic push success could not be recorded:", markError);
    }

    return json({
      ok: true,
      claimed: pending.length,
      sent,
      failed,
      noSubscription,
      notificationsSent: sentNotificationIds.size,
      removedExpired: [...new Set(expiredSubscriptionIds)].length
    });
  }

  if (!userId) return json({ error: "Sign in to manage device notifications." }, 401);
  let notificationIdForDispatch: string | null = null;
  let announcementIdForDispatch: string | null = null;

  if (action === "subscribe") {
    const sub = body.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
    if (!sub?.endpoint || !sub.endpoint.startsWith("https://") || !sub.keys?.p256dh || !sub.keys?.auth) {
      return json({ error: "The browser returned an invalid push subscription." }, 400);
    }
    const { error } = await admin.from("push_subscriptions").upsert({
      user_id: userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      user_agent: String(body.userAgent || "").slice(0, 500),
      last_seen_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (error) {
      console.error("Push subscription save failed:", error);
      return json({ error: "We could not save this device. Please try again." }, 500);
    }
    return json({ ok: true });
  }

  if (action === "unsubscribe") {
    const endpoint = String(body.endpoint || "");
    if (!endpoint.startsWith("https://")) return json({ error: "Invalid device endpoint." }, 400);
    const { error } = await admin.from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint);
    if (error) return json({ error: "Unable to remove this device subscription." }, 500);
    return json({ ok: true });
  }

  if (action !== "test" && action !== "send" && action !== "announcement_push" && action !== "dispatch_notification") return json({ error: "Unknown notification action." }, 400);
  if (!vapidPublic || !vapidPrivate) return json({ error: "The notification delivery keys have not been configured yet." }, 503);
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  let targetIds = [userId];
  let payload: Record<string, unknown> = {
    title: "Clariva notification test",
    body: "Your device is connected to Clariva notifications.",
    url: "./",
    tag: "clariva-push-test"
  };

  if (action === "dispatch_notification") {
    const { data: profile, error: profileError } = await admin.from("students")
      .select("Role,Verified,password_reset_required").eq("user_id", userId).maybeSingle();
    const role = String(profile?.Role || "").toLowerCase();
    if (profileError || profile?.Verified !== true || profile?.password_reset_required === true || !["admin", "owner"].includes(role)) {
      return json({ error: "Only verified Clariva administrators can dispatch system notifications." }, 403);
    }

    const notificationId = String(body.notificationId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) {
      return json({ error: "A valid notification reference is required." }, 400);
    }
    const { data: notification, error: notificationError } = await admin.from("notifications")
      .select("id,event_type,title,message,destination,push_sent_at")
      .eq("id", notificationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (notificationError || !notification) return json({ error: "The notification could not be found." }, 404);
    if (!["new_registration", "resource_uploaded", "resource_deleted", "platform"].includes(notification.event_type)) {
      return json({ error: "This notification is not eligible for automatic push delivery." }, 400);
    }
    if (notification.push_sent_at) return json({ ok: true, sent: 0, alreadySent: true });
    notificationIdForDispatch = notification.id;
    targetIds = [userId];
    payload = {
      title: notification.title,
      body: notification.message,
      url: notification.destination,
      tag: ("clariva-event-" + notification.id).slice(0, 80)
    };
  }

  if (action === "send" || action === "announcement_push") {
    const { data: profile, error: profileError } = await admin.from("students")
      .select("Role,Verified,password_reset_required").eq("user_id", userId).maybeSingle();
    const role = String(profile?.Role || "").toLowerCase();
    if (profileError || profile?.Verified !== true || profile?.password_reset_required === true || !["admin", "owner"].includes(role)) {
      return json({ error: "Only verified Clariva administrators can send platform notifications." }, 403);
    }

    if (action === "send") {
      const requestedIds = Array.isArray(body.userIds) ? body.userIds.map(String).slice(0, 500) : [];
      if (!requestedIds.length) return json({ error: "Select at least one recipient." }, 400);
      targetIds = [...new Set(requestedIds)];
      const title = String(body.title || "").trim().slice(0, 80);
      const message = String(body.message || "").trim().slice(0, 220);
      const url = String(body.url || "./");
      if (!title || !message || (!url.startsWith("/") && !url.startsWith("./")) || url.startsWith("//") || url.includes("\\")) {
        return json({ error: "Provide a title, message and same-site destination." }, 400);
      }
      payload = { title, body: message, url, tag: String(body.tag || crypto.randomUUID()).slice(0, 80) };
    } else {
      const announcementId = String(body.announcementId || "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(announcementId)) {
        return json({ error: "A valid announcement reference is required." }, 400);
      }
      const { data: announcement, error: announcementError } = await admin.from("announcements")
        .select("id,title,message,destination").eq("id", announcementId).maybeSingle();
      if (announcementError || !announcement) return json({ error: "The published announcement could not be found." }, 404);
      const { data: recipients, error: recipientsError } = await admin.from("announcement_recipients")
        .select("user_id").eq("announcement_id", announcementId).is("push_sent_at", null);
      if (recipientsError) return json({ error: "Unable to retrieve announcement recipients." }, 500);
      targetIds = [...new Set((recipients || []).map((row: { user_id: string }) => row.user_id))];
      announcementIdForDispatch = announcement.id;
      if (!targetIds.length) return json({ ok: true, sent: 0, failed: 0, removedExpired: 0 });
      payload = {
        title: announcement.title,
        body: announcement.message,
        url: announcement.destination,
        tag: ("clariva-announcement-" + announcement.id).slice(0, 80)
      };
    }
  }

  const subscriptions: Array<{ id: string; user_id: string; endpoint: string; p256dh: string; auth: string }> = [];
  for (let offset = 0; offset < targetIds.length; offset += 500) {
    const userBatch = targetIds.slice(offset, offset + 500);
    const { data, error } = await admin.from("push_subscriptions")
      .select("id,user_id,endpoint,p256dh,auth").in("user_id", userBatch);
    if (error) return json({ error: "Unable to retrieve notification recipients." }, 500);
    subscriptions.push(...(data || []));
  }

  let sent = 0;
  let failed = 0;
  const sentUserIds = new Set<string>();
  const expired: string[] = [];
  const subscriptionBatchSize = 50;
  for (let offset = 0; offset < subscriptions.length; offset += subscriptionBatchSize) {
    const batch = subscriptions.slice(offset, offset + subscriptionBatchSize);
    await Promise.all(batch.map(async (row: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth }
        }, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
        sent++;
        sentUserIds.add(row.user_id);
      } catch (error) {
        failed++;
        const statusCode = Number((error as { statusCode?: number })?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) expired.push(row.id);
        else console.error("Push delivery failed:", statusCode, error);
      }
    }));
  }
  if (expired.length) await admin.from("push_subscriptions").delete().in("id", expired);
  if (announcementIdForDispatch && sentUserIds.size > 0) {
    const { error: recipientUpdateError } = await admin.from("announcement_recipients")
      .update({ push_sent_at: new Date().toISOString() })
      .eq("announcement_id", announcementIdForDispatch)
      .in("user_id", [...sentUserIds]);
    if (recipientUpdateError) console.error("Announcement push delivery status could not be saved:", recipientUpdateError);
  }
  if (notificationIdForDispatch && sent > 0) {
    const { error: deliveryUpdateError } = await admin.from("notifications")
      .update({ push_sent_at: new Date().toISOString() })
      .eq("id", notificationIdForDispatch)
      .eq("user_id", userId);
    if (deliveryUpdateError) console.error("Notification push status could not be saved:", deliveryUpdateError);
  }
  return json({ ok: true, sent, failed, removedExpired: expired.length });
});
