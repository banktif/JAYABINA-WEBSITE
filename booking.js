/* ============================================================
   JAYACLEAN — Shared Booking + Bayarcash Module (booking.js)
   Drop this into any homepage version. Replaces placeholder
   booking forms with the real Supabase/Bayarcash flow.
   ============================================================ */

(function () {
  var SB = supabase.createClient(
    "https://thbscwlcyhcnqsppoyfn.supabase.co",
    "sb_publishable_jFrl83f8l_tcWTulTL5lkQ_bLnCVpYR"
  );
  var BC_FN =
    "https://thbscwlcyhcnqsppoyfn.supabase.co/functions/v1/bayarcash/create-intent";

  var DEPOSIT = 150;
  var TOTAL = 300;

  function todayISO() {
    var d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  function fmtDate(d) {
    if (!d) return "-";
    var p = d.split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }

  // Render the inline booking form
  function mountBooking() {
    var sections = document.querySelectorAll('[id*="tempah"], [id*="booking"], form.borang');
    if (!sections.length) return;

    var today = todayISO();
    var formHTML =
      '<div id="jayaBookingWrap" style="display:grid;gap:12px">' +
      '  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
      '    <div><label class="jbl">Nama</label><input id="jbNama" class="jbi" placeholder="Cth: Aiman bin Rashid" autocomplete="name" required></div>' +
      '    <div><label class="jbl">No. WhatsApp</label><input id="jbTel" class="jbi" type="tel" autocomplete="tel" inputmode="tel" placeholder="Cth: 0123456789" required></div>' +
      "  </div>" +
      '  <div><label class="jbl">Alamat</label><input id="jbAlamat" class="jbi" placeholder="Cth: No 12, Jalan Mawar, Taman Melur, Shah Alam" required></div>' +
      '  <div><label class="jbl">Tarikh</label><input id="jbTarikh" class="jbi" type="date" min="' +
      today +
      '" value="' +
      today +
      '" required></div>' +
      '  <div><label class="jbl">Slot</label><select id="jbSlot" class="jbi"><option value="9am">9:00 AM</option><option value="11am">11:00 AM</option><option value="2pm">2:00 PM</option><option value="4pm">4:00 PM</option></select></div>' +
      '  <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#eaf7ee;border-radius:12px;padding:12px">' +
      '    <span><b>Deposit 50%</b><br><small>Dari harga RM' + TOTAL + "</small></span>" +
      '    <strong style="font-size:1.3rem;color:#166534">RM' + DEPOSIT + "</strong>" +
      "  </div>" +
      '  <button class="jbb" id="jbbPay">Bayar Deposit RM' +
      DEPOSIT +
      " \u2192</button>" +
      '  <div id="jbMsg" style="display:none;text-align:center;font-size:.85rem;padding:10px;border-radius:10px;background:#fef3c7;color:#92400e"></div>' +
      "</div>";

    // Inject into the first booking section found
    var container = sections[0];
    // Ensure child elements exist for injection
    var formEl = container.querySelector("form");
    if (formEl) {
      formEl.innerHTML = formHTML;
    } else {
      container.innerHTML = container.innerHTML + formHTML;
    }

    // Wire submit
    var btn = document.getElementById("jbbPay");
    if (btn) btn.addEventListener("click", doBooking);

    // Inject minimal CSS
    var style = document.createElement("style");
    style.textContent =
      ".jbi{width:100%;min-height:44px;border:1px solid #ccc;border-radius:10px;padding:10px 12px;font-family:inherit;font-size:15px;background:#fff;color:#1a1a1a}.jbi:focus{border-color:#166534;outline:none;box-shadow:0 0 0 2px rgba(22,101,52,.15)}.jbl{display:block;font-weight:700;font-size:13px;margin-bottom:5px;color:#444}.jbb{width:100%;min-height:50px;border:none;border-radius:14px;background:#166534;color:#fff;font-weight:800;font-size:1rem;cursor:pointer;font-family:inherit;box-shadow:0 4px 14px rgba(22,101,52,.3);transition:transform .12s,background .15s}.jbb:active{transform:scale(.97)}.jbb:disabled{opacity:.6}";
    document.head.appendChild(style);
  }

  async function doBooking() {
    var btn = document.getElementById("jbbPay");
    var msg = document.getElementById("jbMsg");
    var nama =
      (document.getElementById("jbNama").value || "").trim();
    var tel =
      (document.getElementById("jbTel").value || "").trim();
    var alamat =
      (document.getElementById("jbAlamat").value || "").trim();
    var tarikh = document.getElementById("jbTarikh").value;
    var slot = document.getElementById("jbSlot").value;
    if (!nama || !tel || !alamat || !tarikh) {
      if (msg) { msg.style.display = "block"; msg.textContent = "Sila isi semua ruangan."; }
      return;
    }
    btn.disabled = true;
    btn.textContent = "Menyimpan...";

    try {
      var { data: booking, error: berr } = await SB.from("bookings")
        .insert({
          customer_name: nama,
          customer_phone: tel,
          customer_address: alamat,
          booking_date: tarikh,
          booking_time: slot,
          amount: TOTAL,
          deposit_amount: DEPOSIT,
          status: "pending_payment",
          payment_status: "pending",
        })
        .select();
      if (berr) throw new Error(berr.message);
      var bookingId = booking[0].id;

      // Reserve slot (best-effort)
      try {
        await SB.from("slots").insert({ date: tarikh, time_slot: slot, is_booked: true, booking_id: bookingId });
      } catch (_e) { /* slot may already be taken */ }

      btn.textContent = "Ke halaman bayaran...";
      var res = await fetch(BC_FN, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, origin: location.origin }),
      });
      var pay = await res.json();
      if (res.ok && pay.url) {
        location.href = pay.url;
        return;
      }
      throw new Error("gateway");
    } catch (e) {
      btn.disabled = false;
      btn.innerHTML = "Bayar Deposit RM" + DEPOSIT + " \u2192";
      if (msg) {
        msg.style.display = "block";
        msg.style.background = "#fdecec";
        msg.style.color = "#c0392b";
        msg.textContent =
          "Ralat: " +
          (e.message || "tidak diketahui") +
          ". Sila cuba semula atau hubungi WhatsApp.";
      }
    }
  }

  // Run on DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountBooking);
  } else {
    mountBooking();
  }
})();
