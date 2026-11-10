/* jshint esversion: 11, browser: true, devel: true, asi: true, laxbreak: true, undef: false, unused: false */
/* eslint-env browser, es2022 */
// ---- part 2 of 6 ----
function saveDraft() {
    try {
        if ($("formModal").classList.contains("hidden")) return;
        const data = {};
        activeForm().querySelectorAll("input, select, textarea").forEach((el) => {
            if (!el.name || el.type === "file" || el.type === "password") return;
            if (el.type === "checkbox") { (data[el.name] = data[el.name] || []); if (el.checked) data[el.name].push(el.value); }
            else if (el.type === "radio") { if (el.checked) data[el.name] = el.value; }
            else data[el.name] = el.value;
        });
        localStorage.setItem(draftKey(), JSON.stringify({ t: Date.now(), data }));
    } catch (e) {}
}
function clearDraft(t) { try { localStorage.removeItem(draftKey(t)); } catch (e) {} }
function restoreDraft() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(draftKey()) || "null"); } catch (e) {}
    $("draftNote").classList.add("hidden");
    if (!saved || !saved.data || Date.now() - saved.t > DRAFT_DAYS * 864e5) return false;
    const d = saved.data, form = activeForm();
    form.querySelectorAll("input, select, textarea").forEach((el) => {
        if (!el.name || el.type === "file" || el.type === "password" || !(el.name in d)) return;
        if (el.type === "checkbox") el.checked = (d[el.name] || []).indexOf(el.value) >= 0;
        else if (el.type === "radio") el.checked = d[el.name] === el.value;
        else if (el.id !== "bizCategory") el.value = d[el.name];
    });
    updateBizCategories();
    if (d.bizCategory) $("bizCategory").value = d.bizCategory;
    updateRequirements();
    $("draftNote").classList.remove("hidden");
    return true;
}
function startOverDraft() { const t = $("documentType").value; clearDraft(t); openApplicationForm(t); }
function queueDraftSave(e) {
    const f = e.target && e.target.closest && e.target.closest("#bizForm, #clrForm");
    if (!f) return;
    clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 400);
}
document.addEventListener("input", queueDraftSave);
document.addEventListener("change", queueDraftSave);

// Show NEW or RENEWAL requirement checklist
function updateRequirements() {
    const pk = $("documentType").value === "Pangkabuhayan";
    const checked = document.querySelector('#bizForm input[name="appType"]:checked');
    const isRenewal = !pk && checked && checked.value === "Renewal";
    $("appTypeSection").classList.toggle("hidden", pk);          // Pangkabuhayan is always NEW
    const show = { reqNew: !pk && !isRenewal, reqRenewal: isRenewal, reqPK: pk };
    Object.keys(show).forEach((id) => {
        $(id).classList.toggle("hidden", !show[id]);
        // Hidden list's inputs are disabled so they are not required / not validated
        $(id).querySelectorAll("input").forEach((i) => (i.disabled = !show[id]));
    });
    // Pangkabuhayan: only requirements + owner name + nature of business.
    document.querySelectorAll("#bizForm .biz-only").forEach((el) => {
        el.classList.toggle("hidden", pk);
        el.querySelectorAll("input, select, textarea").forEach((i) => (i.disabled = pk));
    });
    document.querySelectorAll("#bizForm .pk-only").forEach((el) => {
        el.classList.toggle("hidden", !pk);
        el.querySelectorAll("input, select, textarea").forEach((i) => (i.disabled = !pk));
    });
}

// Close modal by clicking the dark backdrop or pressing Escape
// (Tapping the dark backdrop no longer closes the form, so nothing is lost by accident.)
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("formModal").classList.contains("hidden")) closeFormModal();
});
// Red borders only after the user has touched a field
document.addEventListener("blur", (e) => {
    if (e.target && e.target.classList && e.target.matches && e.target.matches("input, select, textarea")) {
        e.target.classList.add("touched");
    }
}, true);

// --- COLLECT FORM DATA --------------------------------
function collectBusiness(form) {
    const f = new FormData(form);
    const g = (k) => (f.get(k) || "").toString().trim();
    const owner = fullName(g("ownerFirst"), g("ownerMiddle"), g("ownerLast"));
    const pk = $("documentType").value === "Pangkabuhayan";
    const details = {
        "Application Type": $("documentType").value === "Pangkabuhayan" ? "New" : g("appType"),
        "Date of Application": g("dateApplication") || todayISO(),
        "Business Trade Name": g("tradeName"),
        "Type of Business": pk ? g("pkNature") : g("businessType"),
        "Owner": owner,
        "Company Name": g("companyName"),
        "Owner Home Address": g("ownerAddress"),
        "Business Contact No.": g("contactBusiness"),
        "Owner Contact No.": g("ownerContact"),
        "Business Location": g("businessLocation"),
        "CCTV": g("cctv") + (g("cctvCount") ? " (" + g("cctvCount") + " cameras)" : ""),
        "Store Hours": g("storeHours"),
        "Business Capital (Php)": g("capital"),
        "TIN": g("tin"),
        "DTI Registration No.": g("dtiNo"),
        "DTI Registration Date": g("dtiDate"),
        "Employer SSS No.": g("sssNo"),
        "No. of Employees": g("employees"),
        "Rented Since": g("rentSince"),
        "Monthly Rental (Php)": g("rentMonthly"),
        "Rented From": g("rentFrom"),
        "Signboard": g("signboard") + (g("signboardArea") ? " (" + g("signboardArea") + ")" : ""),
        "Business Group": $("documentType").value === "Pangkabuhayan" ? "Pangkabuhayan (free)" : ((BUSINESS_GROUPS[g("bizGroup")] || {}).label || ""),
        "Group Code": $("documentType").value === "Pangkabuhayan" ? "PK" : g("bizGroup"),
        "Nature of Business": pk ? g("pkNature") : g("bizCategory") ? g("bizCategory") + (g("natureOfBusiness") ? " - " + g("natureOfBusiness") : "") : g("natureOfBusiness"),
        "Signed By": g("signature")
    };
    return { name: pk ? owner : g("tradeName"), details };
}

function collectClearance(form) {
    const f = new FormData(form);
    const g = (k) => (f.get(k) || "").toString().trim();
    const purposes = f.getAll("purpose");
    const applicant = fullName(g("appFirst"), g("appMiddle"), g("appLast"));
    const details = {
        "Head of Family": fullName(g("headFirst"), g("headMiddle"), g("headLast")),
        "Head Address": g("headAddress"),
        "Head Age": g("headAge"),
        "Year of Residence": g("headResidence"),
        "Head Civil Status": g("headCivil"),
        "Head Gender": g("headGender"),
        "Head Birthday": g("headBirthday"),
        "Head Birthplace": g("headBirthplace"),
        "Applicant": applicant,
        "Address": g("appAddress"),
        "Civil Status": g("appCivil"),
        "Gender": g("appGender"),
        "Age": g("appAge"),
        "Birthday": g("appBirthday"),
        "Birthplace": g("appBirthplace"),
        "Contact No.": g("appContact"),
        "Religion": g("appReligion"),
        "Citizenship": g("appCitizenship"),
        "Precinct No.": g("appPrecinct"),
        "Purpose": purposes.join(", "),
        "Renewal": g("renew") ? "Yes" : "",
        "Clearance For": g("clearanceFor"),
        "To Agency/Office": g("toAgency"),
        "Patient/Student": g("patName"),
        "Patient Age": g("patAge"),
        "Patient Civil Status": g("patCivil"),
        "Patient Gender": g("patGender"),
        "Patient Birthday": g("patBirthday"),
        "Patient Birthplace": g("patBirthplace"),
        "Patient Precinct No.": g("patPrecinct"),
        "Relation to Applicant": g("patRelation"),
        "Signed By": g("signature")
    };
    return { name: applicant, details, purposes };
}

// --- REQUIREMENT FILE UPLOADS -------------------------
async function uploadRequirements(form) {
    const result = {};
    const folder = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    const inputs = form.querySelectorAll('input[type="file"]:not(:disabled)');
    for (const input of inputs) {
        const file = input.files && input.files[0];
        if (!file) continue;
        if (file.size > MAX_FILE_MB * 1024 * 1024) {
            throw new Error(file.name + " is larger than " + MAX_FILE_MB + " MB.");
        }
        const label = input.closest(".req-item").querySelector("label").innerText.trim();
        if (db) {
            const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
            const path = folder + "/" + input.name + "-" + safe;
            const { error } = await db.storage.from("requirements").upload(path, file);
            if (error) throw new Error("Upload failed for " + label + ": " + error.message);
            result[label] = path;
        } else {
            result[label] = file.name; // demo mode: just remember the file name
        }
    }
    return result;
}


// --- PAYMENT (done by the secure backend) -------------
// The website never sees a PayMongo key. It asks the "create-payment" Edge Function,
// which creates the PayMongo link on the server and returns only the checkout URL.
async function requestPayment(serial) {
    const { data, error } = await db.functions.invoke("create-payment", { body: { serial } });
    if (error) throw error;
    if (!data || !data.url) throw new Error((data && data.error) || "No payment link returned");
    return { url: data.url, id: data.id };
}

// --- DATABASE LAYER (applicant side) -------------------
function demoList() {
    try { return JSON.parse(localStorage.getItem("demoClearances") || "[]"); } catch (e) { return []; }
}
function demoSave(list) {
    try { localStorage.setItem("demoClearances", JSON.stringify(list)); } catch (e) {}
}

async function saveApplication(name, docType, details) {
    if (db) {
        const { data, error } = await db.rpc("submit_application", {
            p_name: name, p_doc_type: docType, p_details: details
        });
        if (error) throw error;
        return { serial: data, status: "pending" };
    }
    // demo mode - number format YY-NNNN (digits only), restarts at 0001 every year
    const list = demoList();
    const yy = String(new Date().getFullYear()).slice(-2);
    let highest = 0;
    list.forEach((r) => {
        const m = /^(\d{2})-(\d+)$/.exec(r.serial || "");
        if (m && m[1] === yy) highest = Math.max(highest, parseInt(m[2], 10));
    });
    const serial = yy + "-" + String(highest + 1).padStart(4, "0");
    const amount = feeFor(docType, details);
    if (amount === null) throw new Error("Please choose the business group");
    const free = amount === 0, nowIso = new Date().toISOString();
    list.push({ serial, name, document_type: docType, details, status: free ? "paid" : "pending", stage: "submitted", created_at: nowIso, issued_at: free ? nowIso : null, amount_centavos: amount });
    demoSave(list);
    return { serial, status: "pending" };
}

// --- SUBMIT APPLICATION (APPLICANT) -------------------
async function processApplication() {
    const docType = $("documentType").value;
    const form = activeForm();
    showFormError("");

    // Built-in browser validation
    form.querySelectorAll("input, select, textarea").forEach((el) => el.classList.add("touched"));
    if (!form.checkValidity()) {
        const bad = form.querySelector(":invalid");
        form.reportValidity();
        if (bad) bad.focus();
        showFormError("Please complete all required fields (and attach every requirement).");
        return;
    }

    let data;
    if (isBizType(docType)) {
        data = collectBusiness(form);
    } else {
        data = collectClearance(form);
        if (!data.purposes.length) {
            showFormError("Please tick at least one Purpose.");
            return;
        }
    }

    const btn = $("submitBtn");
    const idleText = btn.innerText;
    btn.disabled = true;
    btn.innerText = "Processing…";

    try {
        // 1) Upload requirement files (permits)
        const files = await uploadRequirements(form);
        if (Object.keys(files).length) data.details["Requirements"] = files;

        // 2) Save record (the database creates the reference number)
        const saved = await saveApplication(data.name, docType, data.details);

        // 3) Payment link from the secure backend (only when enabled in config.js)
        let payment = null;
        let payNote = "";
        if (db && ENABLE_ONLINE_PAYMENT && feeFor(docType, data.details) > 0) {
            try {
                payment = await requestPayment(saved.serial);
            } catch (e) {
                console.error(e);
                payNote = "Online payment is unavailable right now. Please pay at the Barangay Hall and show your reference number.";
            }
        }

        // 4) Confirmation for the applicant (NOT the certificate - only admins can print that)
        clearDraft(docType);
        closeFormModal();
        showConfirmation({ serial: saved.serial, name: data.name, document_type: docType, amount: feeFor(docType, data.details) }, payment, payNote);
    } catch (err) {
        console.error(err);
        showFormError("Something went wrong: " + (err.message || err));
        btn.disabled = false;
        btn.innerText = idleText;
    }
}