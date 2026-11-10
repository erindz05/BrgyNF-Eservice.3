/* jshint esversion: 11, browser: true, devel: true, asi: true, laxbreak: true, undef: false, unused: false */
/* eslint-env browser, es2022 */
// ---- part 1 of 6 ----
"use strict";
var _c = window.APP_CONFIG || {};
var SUPABASE_URL = _c.SUPABASE_URL || "";
var SUPABASE_KEY = _c.SUPABASE_KEY || "";
var ENABLE_ONLINE_PAYMENT = !!_c.ENABLE_ONLINE_PAYMENT;
var PUNONG_BARANGAY = _c.PUNONG_BARANGAY || "HON. AMELIA C. CHUA";
var PUNONG_BARANGAY_TITLE = _c.PUNONG_BARANGAY_TITLE || "Punong Barangay";
var SITE_URL = _c.SITE_URL || "";
var IMAGES = Object.assign({ logo: "", banner: "", seal: "", bagongPilipinas: "", signature: "", certificateBackground: "" }, _c.IMAGES || {});
// =====================================================
//  BARANGAY NORTH FAIRVIEW eSERVICES PORTAL
//  (keys, pictures and certificate details are in config.js)
// =====================================================

// --- THEME (LIGHT / DARK) ---
function toggleTheme() {
    const body = document.body;
    const btn = document.getElementById("themeToggleBtn");
    body.classList.toggle("dark-mode");
    const dark = body.classList.contains("dark-mode");
    btn.innerHTML = (dark ? "☀️" : "🌙") + "<br>Mode";
    try { localStorage.setItem("siteTheme", dark ? "dark" : "light"); } catch (e) {}
}

// --- BACKEND CONNECTION -------------------------------
const isSet = (v) => typeof v === "string" && v.length > 0 && !v.startsWith("YOUR_");

let db = null; // Supabase client (null = demo mode)
try {
    if (isSet(SUPABASE_URL) && isSet(SUPABASE_KEY) && window.supabase) {
        db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    }
} catch (err) {
    console.error("Supabase init failed, running in demo mode:", err);
}

let currentCert = null; // application whose certificate is on screen (admin only)

// --- FEES (fixed by the barangay fee schedule; nobody edits them on the website) --------------
// Amounts are in centavos (100 = P1.00). The database has the SAME rules (fee_for), so the
// price can never be changed from the browser.
const BUSINESS_GROUPS = {
 "A": {
  "label": "Group A",
  "amount": 100000,
  "items": [
   "Food stalls",
   "Hawker",
   "Junk Shops/Retailer Scrap Materials",
   "Key Duplication",
   "Market Vendor",
   "Pushcart Vendor/ Street & Market Vendors",
   "E-Loading Station/Cellphone Shop",
   "Sari-sari store",
   "Shoe/Bag Repair",
   "Vulcanizing/Tire Repair"
  ]
 },
 "B": {
  "label": "Group B",
  "amount": 200000,
  "items": [
   "Bakeries/Bakeshops",
   "Car Wash",
   "Carinderia/ Mini-restaurant",
   "Computer Shop/Internet Café",
   "Entertainment/Event Organizer/Supplier",
   "Food/beverage or hospitality services, restaurants",
   "Garments / Ukay-Ukay",
   "General Store/ Hardware Store",
   "Janitorial/Cleaning Services",
   "Jewelry Making/Repair",
   "Laundry Shop",
   "Labor Services (Salon, nail services, barber shop)",
   "Pest control",
   "Pet shop",
   "Photocopying/Printing",
   "Public Utility Terminal (Tricycle)",
   "Recruitment/Manpower",
   "Sash and Wood Works",
   "Septic Tank Siphoning",
   "Softdrinks / Liquor Dealer",
   "Tailoring",
   "Upholstery",
   "Watch Repair",
   "Water refilling"
  ]
 },
 "C": {
  "label": "Group C",
  "amount": 300000,
  "items": [
   "Advertising Agency/Promotional",
   "Administration Office",
   "Air Conditioning/Refrigeration Maintenance or Repair",
   "Aluminum/Glass/Ironworks Supplier or installer",
   "Appliance Dealer",
   "Audio Repair/ Electronics/ Radio Electrical Equipment Services",
   "Auto Repair or Maintenance Shop",
   "Book and Newspaper Publishing",
   "Business and Information Services",
   "Collecting Agency",
   "Construction and Utilities Contractor/ Supplier/ Service Provider",
   "Dental Clinic",
   "Emission Testing",
   "Furniture Dealer",
   "Funeral Services/Columbarium",
   "Labor Agency",
   "Machine Shop",
   "Health Clinic/Care Center",
   "Office Equipment Dealer",
   "Security Services",
   "Technical/Vocational Services (Plumbing, Electrical, Building Maintenance/Repair, etc.)",
   "Travel Agency",
   "Veterinary Clinic"
  ]
 },
 "D": {
  "label": "Group D",
  "amount": 400000,
  "items": [
   "Car Rental Services",
   "Delivery/Courier Services",
   "Pawnshop/Micro-Lending",
   "Pharmacy",
   "Public Utility Terminal (Bus or Taxi)",
   "Schools/Education Services/Tutorial Center",
   "Public Transportation Services (Taxi, Bus, Jeepney etc.)",
   "Slaughter House",
   "Truck/Hauling"
  ]
 },
 "E": {
  "label": "Group E",
  "amount": 500000,
  "items": [
   "Auto/Truck Dealer",
   "Banks and Financial Services/Insurance/Pre-Need",
   "Condominium",
   "Gasoline Station",
   "Heavy Equipment Shop/Services",
   "Hospitals",
   "Hotel/Motel/Apartelle",
   "Industrial Manufacturing",
   "KTV Bar/Music Lounge",
   "Money Changer",
   "Night Clubs/Cocktail Lounges and Beer House",
   "Real Estate and/or Housing",
   "Shopping Mall, Supermarket",
   "Telecommunications"
  ]
 }
};
BUSINESS_GROUPS.NC  = { label: "Business not otherwise categorized", amount: 200000, items: [] };
BUSINESS_GROUPS.REG = { label: "Regulated business (DILG Memo 2003-231, 12-10-2003) - resolution required", amount: 200000, items: [] };
// Clearance fee per purpose (centavos). Edit the pesos in config.js -> CLEARANCE_FEES
const _cf = Object.assign({ "Residency": 50, "Clearance": 100, "Non Resident": 250 }, _c.CLEARANCE_FEES || {});
const CLEARANCE_FEES = {};
Object.keys(_cf).forEach((k) => { CLEARANCE_FEES[k] = Math.round(Number(_cf[k]) * 100); });
const CLEARANCE_FEE = CLEARANCE_FEES["Clearance"];            // fallback for any other purpose
const FREE_PURPOSES = ["Indigency", "Medical", "Financial"];  // no payment for these
const DEFAULT_FEES = { "Business Permit": 50000, "Barangay Clearance": CLEARANCE_FEE }; // only for old records saved before groups existed
const fees = DEFAULT_FEES;
const DOCUMENT_LABELS = {
    "Business Permit": "Barangay Business Permit",
    "Pangkabuhayan": "Pangkabuhayan Business Permit",
    "Barangay Clearance": "Barangay Clearance"
};

// Price of an application. Returns centavos, or null if the business group is not chosen yet.
const isBizType = (t) => t === "Business Permit" || t === "Pangkabuhayan";
function feeFor(docType, details) {
    details = details || {};
    if (docType === "Pangkabuhayan") return 0;                        // always free
    if (docType === "Business Permit") {
        const g = BUSINESS_GROUPS[details["Group Code"]];
        return g ? g.amount : null;
    }
    const purposes = String(details["Purpose"] || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (!purposes.length) return null;                                   // no purpose ticked yet
    const paid = purposes.filter((p) => FREE_PURPOSES.indexOf(p) < 0);
    if (!paid.length) return 0;                                          // only Indigency / Medical / Financial
    return Math.max.apply(null, paid.map((p) => (CLEARANCE_FEES[p] != null ? CLEARANCE_FEES[p] : CLEARANCE_FEE)));
}

// --- HELPERS ------------------------------------------
const $ = (id) => document.getElementById(id);
const MAX_FILE_MB = 5;

function todayISO() {
    return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}
function peso(centavos) {
    return "₱" + (centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2 });
}
function longDate(iso) {
    const d = iso ? new Date(iso) : new Date();
    return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}
function fullName(first, middle, last) {
    return [first, middle, last].map((s) => (s || "").trim()).filter(Boolean).join(" ");
}
function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}
function showFormError(msg) {
    const box = $("formError");
    if (!msg) { box.classList.add("hidden"); box.textContent = ""; return; }
    box.textContent = msg;
    box.classList.remove("hidden");
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// --- STEP 1: ROLE SELECTION ---------------------------
function showOnly(id) {
    ["roleScreen", "applicantView", "adminView"].forEach((x) => $(x).classList.toggle("hidden", x !== id));
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function showRoleScreen() {
    closeFormModal();
    $("confirmCard").classList.add("hidden");
    await logoutAdmin();          // leaving the admin area always signs out (shared phones!)
    showOnly("roleScreen");
}

async function chooseRole(role) {
    if (role === "applicant") {
        showOnly("applicantView");
    } else {
        showOnly("adminView");
        await restoreAdminSession();
    }
}

// --- MODAL CONTROLS (APPLICATION FORMS) ---------------
function activeForm() {
    return isBizType($("documentType").value) ? $("bizForm") : $("clrForm");
}

function openApplicationForm(docType) {
    $("documentType").value = docType;
    setFormTitle();
    $("confirmCard").classList.add("hidden");
    showFormError("");

    const biz = $("bizForm");
    const clr = $("clrForm");
    biz.reset();
    clr.reset();
    biz.querySelectorAll(".touched").forEach((el) => el.classList.remove("touched"));
    clr.querySelectorAll(".touched").forEach((el) => el.classList.remove("touched"));

    biz.classList.toggle("hidden", !isBizType(docType));
    clr.classList.toggle("hidden", isBizType(docType));
    renderClearanceFees();

    $("bizDate").value = todayISO();
    updateBizCategories();
    updateRequirements();
    $("guideSearch").value = ""; renderGuide("");
    restoreDraft();

    $("submitBtn").disabled = false;
    setSubmitLabel();
    $("formModal").classList.remove("hidden");
    document.body.style.overflow = "hidden";
    $("formModal").querySelector(".modal-body").scrollTop = 0;
}

function setFormTitle() {
    const docType = $("documentType").value;
    if (docType) $("modalFormTitle").innerText = "Apply for " + (DOCUMENT_LABELS[docType] || docType);
}

function setSubmitLabel() {
    const docType = $("documentType").value;
    if (!docType) return;
    const form = activeForm();
    const fd = new FormData(form);
    const amount = feeFor(docType, isBizType(docType)
        ? { "Group Code": ($("bizGroup") || {}).value }
        : { "Purpose": fd.getAll("purpose").join(", ") });
    let text;
    if (amount === null) text = isBizType(docType) ? "Submit Application (choose your business group)" : "Submit Application (tick a purpose)";
    else if (amount === 0) text = "Submit Application (FREE)";
    else text = (db && ENABLE_ONLINE_PAYMENT ? "Submit & Proceed to GCash / Maya (" : "Submit Application (Fee ") + peso(amount) + ")";
    $("submitBtn").innerText = text;
}

// Show the fee next to each clearance purpose
function renderClearanceFees() {
    document.querySelectorAll(".fee-tag").forEach((el) => {
        const p = el.dataset.purpose;
        el.textContent = FREE_PURPOSES.indexOf(p) >= 0 ? "- FREE" : (CLEARANCE_FEES[p] != null ? "- " + peso(CLEARANCE_FEES[p]) : "");
    });
}

// Business group -> list of businesses in that group
function updateBizCategories() {
    const pk = $("documentType").value === "Pangkabuhayan";
    const code = $("bizGroup").value, g = BUSINESS_GROUPS[code];
    const sel = $("bizCategory"), box = $("bizCategoryBox"), nd = $("natureDetail");
    const special = pk || code === "NC" || code === "REG";
    $("bizGroupBox").classList.toggle("hidden", pk);
    $("bizGroup").required = !pk;
    box.classList.toggle("hidden", special);
    sel.required = !!g && !special;
    sel.innerHTML = "";
    const first = document.createElement("option");
    first.value = ""; first.textContent = g && !special ? "-- Choose your kind of business --" : "-- Choose a group first --";
    sel.appendChild(first);
    if (g && !special) g.items.forEach((name) => { const o = document.createElement("option"); o.value = name; o.textContent = name; sel.appendChild(o); });
    nd.required = special;
    $("natureHint").textContent = special ? "(required)" : "(optional)";
    $("regNote").classList.toggle("hidden", code !== "REG");
    setSubmitLabel();
}
document.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!t) return;
    if (t.id === "bizGroup") updateBizCategories();
    else if (t.name === "purpose") setSubmitLabel();
});

function closeFormModal() {
    $("formModal").classList.add("hidden");
    document.body.style.overflow = "";
}

// ---------- BUSINESS LIST GUIDE (find your group) ----------
function renderGuide(filter) {
    const q = (filter || "").trim().toLowerCase();
    let html = "", found = 0;
    ["A", "B", "C", "D", "E"].forEach((code) => {
        const g = BUSINESS_GROUPS[code];
        const items = g.items.filter((n) => !q || n.toLowerCase().indexOf(q) >= 0);
        if (!items.length) return;
        found += items.length;
        html += '<div class="guide-group"><div class="guide-head"><b>' + g.label + "</b><span>" + peso(g.amount) + "</span></div>" +
            items.map((n) => '<button type="button" class="guide-item" data-code="' + code + '" data-name="' + escapeHtml(n) + '">' + escapeHtml(n) + "</button>").join("") + "</div>";
    });
    [["NC", "Business not otherwise categorized"], ["REG", "Regulated business (resolution required)"]].forEach((x) => {
        if (q && x[1].toLowerCase().indexOf(q) < 0 && "other".indexOf(q) < 0) return;
        found++;
        html += '<div class="guide-group"><button type="button" class="guide-item" data-code="' + x[0] + '" data-name="">' + x[1] +
            ' <span class="guide-fee">' + peso(BUSINESS_GROUPS[x[0]].amount) + "</span></button></div>";
    });
    $("guideList").innerHTML = html || '<p class="muted">No match. Try another word, or choose "Business not otherwise categorized".</p>';
}
document.addEventListener("input", (e) => { if (e.target && e.target.id === "guideSearch") renderGuide(e.target.value); });
document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".guide-item");
    if (!b) return;
    $("bizGroup").value = b.dataset.code;
    updateBizCategories();
    if (b.dataset.name) $("bizCategory").value = b.dataset.name;
    setSubmitLabel();
    $("groupGuide").open = false;
    queueDraftSave({ target: $("bizGroup") });
    $("bizGroup").scrollIntoView({ behavior: "smooth", block: "center" });
});

// ---------- DRAFT: keep the unfinished form if the person closes it ----------
// Saved only in THIS phone/browser (never sent anywhere). Files cannot be saved. Cleared after submitting.
const DRAFT_PREFIX = "brgyDraft:", DRAFT_DAYS = 7;
function draftKey(t) { return DRAFT_PREFIX + (t || $("documentType").value); }
let draftTimer = null;