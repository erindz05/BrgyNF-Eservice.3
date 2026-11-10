// Supabase Edge Function: create-payment
// Called by the website AFTER an application is saved. It creates a PayMongo payment
// link using the SECRET key (which never leaves the server) and returns the checkout URL.
//
// Secrets needed (Supabase > Edge Functions > Secrets):
//   PAYMONGO_SECRET_KEY   (sk_test_... while testing, sk_live_... when real)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Fallback prices (centavos), used only if the "fees" table has no row for the document.
// The real prices come from the database: the administrator edits them on the website.
const DEFAULT_PRICES: Record<string, number> = {
  "Business Permit": 50000,     // ₱500.00
  "Barangay Clearance": 5000,   // ₱50.00
};

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { serial } = await req.json();
    if (!serial || typeof serial !== "string") return json({ error: "Missing serial" }, 400);

    const secretKey = Deno.env.get("PAYMONGO_SECRET_KEY");
    if (!secretKey) return json({ error: "Payment is not configured on the server" }, 500);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: rec, error } = await admin
      .from("clearances")
      .select("serial, document_type, status, payment_ref, payment_url")
      .eq("serial", serial)
      .maybeSingle();

    if (error) throw error;
    if (!rec) return json({ error: "Application not found" }, 404);
    if (rec.status === "paid") return json({ error: "Already paid" }, 400);

    // Reuse the same link if one was already made for this application
    if (rec.payment_url && rec.payment_ref) {
      return json({ url: rec.payment_url, id: rec.payment_ref });
    }

    // Price is decided HERE on the server, never by the browser
    const { data: feeRow } = await admin
      .from("fees")
      .select("amount_centavos")
      .eq("document_type", rec.document_type)
      .maybeSingle();
    const amount = feeRow?.amount_centavos ?? DEFAULT_PRICES[rec.document_type];
    if (!amount || amount < 100) return json({ error: "Invalid fee (PayMongo minimum is P1.00)" }, 400);

    // No personal data is sent to PayMongo - only the reference number.
    const res = await fetch("https://api.paymongo.com/v1/links", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(secretKey + ":"),
      },
      body: JSON.stringify({
        data: {
          attributes: {
            amount,
            currency: "PHP",
            description: "Brgy North Fairview Official Fee: " + rec.document_type,
            remarks: "Reference: " + rec.serial,
          },
        },
      }),
    });

    const out = await res.json();
    if (!res.ok || out.errors) {
      console.error("PayMongo error", JSON.stringify(out));
      return json({ error: out?.errors?.[0]?.detail ?? "PayMongo request failed" }, 502);
    }

    const url: string = out.data.attributes.checkout_url;
    const id: string = out.data.id;

    const { error: upErr } = await admin
      .from("clearances")
      .update({ payment_ref: id, payment_url: url })
      .eq("serial", serial);
    if (upErr) throw upErr;

    return json({ url, id });
  } catch (err) {
    console.error(err);
    return json({ error: "Server error" }, 500);
  }
});
