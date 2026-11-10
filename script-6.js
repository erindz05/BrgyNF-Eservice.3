/* jshint esversion: 11, browser: true, devel: true, asi: true, laxbreak: true, undef: false, unused: false */
/* eslint-env browser, es2022 */
// ---- part 6 of 6 ----
function renderCertificate(row) {
    currentCert = row;
    const d = row.details || {};
    const e = escapeHtml;
    const year = new Date(row.issued_at || Date.now()).getFullYear();
    const issued = longDate(row.issued_at);
    let body;

    if (isBizType(row.document_type)) {
        const tag = (d["Application Type"] || "NEW").toUpperCase();
        const owner = d["Company Name"] || d["Owner"] || "";
        body = '<div class="cert-banner">BUSINESS CLEARANCE ' + year + (row.document_type === "Pangkabuhayan" ? " (PANGKABUHAYAN)" : "") + '</div>' +
            '<div class="cert-row"><div class="cert-who">TO WHOM IT MAY CONCERN:</div><div class="cert-tag">' + e(tag) + '</div></div>' +
            '<p class="cert-center cert-italic">This is to certify that</p>' +
            '<div class="cert-line cert-big">' + e(row.name) + '</div><div class="cert-cap">NAME OF BUSINESS</div>' +
            '<div class="cert-line">' + e(d["Business Location"]) + '</div><div class="cert-cap">BUSINESS/ OFFICE ADDRESS</div>' +
            '<div class="cert-two"><div><div class="cert-line">' + e(owner) + '</div><div class="cert-cap">OWNER\'S/ COMPANY\'S NAME</div></div>' +
            '<div><div class="cert-line">' + e(d["Type of Business"]) + '</div><div class="cert-cap">KIND OF BUSINESS</div></div></div>' +
            '<p class="cert-text">Is now operating a business within the jurisdiction of this Barangay.</p>' +
            '<p class="cert-text">This clearance is being issued under the requirements of the Local Government Code of 1991, Republic Act 7160, Article IV, Section 152, paragraph C for the purpose of Securing or Renewing Mayor\'s Business Permit from the Quezon City Government.</p>' +
            '<p class="cert-issued">Issued this <u>&nbsp;' + e(issued) + '&nbsp;</u> at<br>Barangay North Fairview, District 5, Quezon City,<br>Metro Manila, Philippines.</p>' +
            '<p class="cert-note"><b class="cert-red">NOTE/CONDITION:</b> This clearance is issued and may be revoked and cancelled anytime should public health, safety, convenience, comfort, interest and social welfare in the area are adversely affected. This Clearance is valid for <b class="cert-red">ONE (1) YEAR</b> from date of issuance in compliance with City Ordinance No. SP-2989, S-2020.</p>';
    } else {
        body = '<div class="cert-banner">BARANGAY CLEARANCE ' + year + '</div>' +
            '<div class="cert-row"><div class="cert-who">TO WHOM IT MAY CONCERN:</div></div>' +
            '<p class="cert-center cert-italic">This is to certify that</p>' +
            '<div class="cert-line cert-big">' + e(row.name) + '</div><div class="cert-cap">NAME OF APPLICANT</div>' +
            '<div class="cert-line">' + e(d["Address"]) + '</div><div class="cert-cap">RESIDENCE ADDRESS</div>' +
            '<div class="cert-two"><div><div class="cert-line">' + e(d["Civil Status"]) + '</div><div class="cert-cap">CIVIL STATUS</div></div>' +
            '<div><div class="cert-line">' + e(d["Age"]) + '</div><div class="cert-cap">AGE</div></div></div>' +
            '<p class="cert-text">Is a resident of Barangay North Fairview, District 5, Quezon City.</p>' +
            '<p class="cert-text">This clearance is issued upon the request of the above-named person for the purpose of <b>' + e(d["Purpose"]) + '</b>' +
            (d["Clearance For"] ? ' (' + e(d["Clearance For"]) + ')' : '') + (d["To Agency/Office"] ? ', to be submitted to ' + e(d["To Agency/Office"]) : '') + '.</p>' +
            '<p class="cert-issued">Issued this <u>&nbsp;' + e(issued) + '&nbsp;</u> at<br>Barangay North Fairview, District 5, Quezon City,<br>Metro Manila, Philippines.</p>';
    }

    const el = $("printable-clearance");
    el.innerHTML = certHeader() + body + certFooter(row);
    const bg = (typeof IMAGES !== "undefined" && IMAGES.certificateBackground) || "";
    el.style.setProperty("--cert-bg", bg ? 'linear-gradient(rgba(255,255,255,.55),rgba(255,255,255,.55)), url("' + bg + '")' : "none");
    $("certPanel").classList.remove("hidden");
    fitCertificate();
}

// The certificate is A4 width (794px). On a phone we shrink the preview to fit.
function fitCertificate() {
    const vp = $("certViewport");
    const c = $("printable-clearance");
    if (!vp || !c || $("certPanel").classList.contains("hidden")) return;
    c.style.transform = "none";
    const scale = Math.min(1, vp.clientWidth / 794);
    c.style.transformOrigin = "top left";
    c.style.transform = scale < 1 ? "scale(" + scale + ")" : "none";
    vp.style.height = Math.ceil(c.offsetHeight * scale) + "px";
}
window.addEventListener("resize", fitCertificate);

function printCertificate() {
    if (!currentCert) return;
    api.log("print", currentCert.serial);
    window.print(); // style.css prints ONLY the certificate
}

function downloadPDF() {
    if (!currentCert) return;
    if (!window.html2pdf) { alert("PDF library did not load. Check your internet connection."); return; }
    api.log("export_pdf", currentCert.serial);
    const el = $("printable-clearance");
    const vp = $("certViewport");
    const oldT = el.style.transform;
    const oldH = vp.style.height;
    el.style.transform = "none";
    vp.style.height = "auto";
    const restore = () => { el.style.transform = oldT; vp.style.height = oldH; fitCertificate(); };
    html2pdf().set({
        margin: 0,
        filename: currentCert.serial + ".pdf",
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }
    }).from(el).save().then(restore).catch(restore);
}


const PIC_NAMES = { logo: "Logo", banner: "Banner", seal: "Seal", bagongPilipinas: "Bagong Pilipinas", signature: "Signature", certificateBackground: "Certificate background" };
function checkPictures() {
    const box = $("picCheck");
    if (!box) return;
    box.innerHTML = Object.keys(PIC_NAMES).map((k) => {
        const v = IMAGES[k] || "";
        const label = v.indexOf("data:") === 0 ? "(pasted picture, " + Math.round(v.length / 1024) + " KB)" : v;
        if (!v) return '<div class="pic-row" data-pic="' + k + '"><div class="pic-none"></div><div class="pic-name">' + PIC_NAMES[k] + '<small>not set</small></div><span class="pic-empty">empty</span></div>';
        return '<div class="pic-row" data-pic="' + k + '"><img alt=""><div class="pic-name">' + PIC_NAMES[k] + "<small>" + escapeHtml(label) + '</small></div><span class="pic-state">checking…</span></div>';
    }).join("");
    Object.keys(PIC_NAMES).forEach((k) => {
        const v = IMAGES[k]; if (!v) return;
        const row = box.querySelector('[data-pic="' + k + '"]'), st = row.querySelector(".pic-state"), im = row.querySelector("img");
        const probe = new Image();
        probe.onload = () => { im.src = v; st.className = "pic-state pic-ok"; st.textContent = "works"; };
        probe.onerror = () => {
            st.className = "pic-state pic-bad";
            st.textContent = v.indexOf("data:") === 0 ? "bad code" : "not found";
            row.querySelector("small").innerHTML += v.indexOf("data:") === 0
                ? "<br>The pasted text is cut or broken. Run image-tool.html again and copy ALL of it."
                : "<br>No file with this exact name in the same folder as index.html (capital letters matter). Or use image-tool.html.";
        };
        probe.src = v;
    });
}

// --- PICTURES, WEBSITE QR CODE, START-UP --------------
function applyImages() {
    const logo = $("navLogo");
    if (IMAGES.logo) {
        logo.onerror = function () { console.warn("Logo not found: '" + String(IMAGES.logo).slice(0, 60) + "'"); logo.style.display = "none"; };
        logo.onload = function () { logo.style.display = ""; };
        logo.src = IMAGES.logo;
    } else {
        logo.style.display = "none";
    }
    if (IMAGES.banner) {
        const hero = $("heroBanner");
        const probe = new Image();
        probe.onload = function () {
            hero.style.backgroundImage = 'linear-gradient(135deg, rgba(27,77,62,0.88), rgba(244,196,48,0.35)), url("' + IMAGES.banner + '")';
            hero.style.backgroundSize = "cover";
            hero.style.backgroundPosition = "center";
        };
        probe.onerror = function () { console.warn("Banner not found: '" + String(IMAGES.banner).slice(0, 60) + "'"); };
        probe.src = IMAGES.banner;
    }
}

// This QR code opens the WEBSITE (not a document), so people can find the portal easily
function makeSiteQr() {
    if (!window.QRCode) return;
    try {
        const url = (typeof SITE_URL !== "undefined" && SITE_URL) || location.href.split("?")[0].split("#")[0];
        $("siteQr").innerHTML = "";
        new QRCode($("siteQr"), { text: url, width: 120, height: 120 });
    } catch (e) { console.error(e); }
}

window.addEventListener("DOMContentLoaded", () => {
    let saved = null;
    try { saved = localStorage.getItem("siteTheme"); } catch (e) {}
    if (saved === "dark") {
        document.body.classList.add("dark-mode");
        $("themeToggleBtn").innerHTML = "☀️<br>Mode";
    }
    applyImages();
    makeSiteQr();

    // admin panel buttons
    $("adminTabs").addEventListener("click", (e) => { const b = e.target.closest(".tab-btn"); if (b) showTab(b.dataset.tab); });
    $("btnSearch").addEventListener("click", () => runSearch(true));
    $("btnClear").addEventListener("click", clearFilters);
    $("btnCsv").addEventListener("click", exportCsv);
    $("btnDashRefresh").addEventListener("click", loadDashboard);
    $("fQ").addEventListener("keydown", (e) => { if (e.key === "Enter") runSearch(true); });
    $("auditFilter").addEventListener("input", renderAudit);
    $("adminList").addEventListener("click", (e) => { const tr_ = e.target.closest("tr.pick"); if (tr_) openRecord(tr_.dataset.serial); });
    $("adminPager").addEventListener("click", (e) => {
        const b = e.target.closest("button");
        if (!b || b.disabled) return;
        curPage += b.id === "pgNext" ? 1 : -1;
        runSearch(false);
    });
    $("adminDetails").addEventListener("click", onDetailsClick);
    $("trashList").addEventListener("click", onTrashClick);
    $("confirmBtn").addEventListener("click", runConfirm);
    $("rejectBtn").addEventListener("click", runReject);
});

// make the buttons in index.html able to call these
window.showRoleScreen = showRoleScreen;
window.updateRequirements = updateRequirements;
window.startOverDraft = startOverDraft;
window.openApplicationForm = openApplicationForm;
window.chooseRole = chooseRole;
window.toggleTheme = toggleTheme;
window.processApplication = processApplication;
window.printCertificate = printCertificate;
window.logoutAdmin = logoutAdmin;
window.downloadPDF = downloadPDF;
window.closeFormModal = closeFormModal;
window.authenticateAdmin = authenticateAdmin;
window.closeConfirm = closeConfirm;
window.closeReject = closeReject;