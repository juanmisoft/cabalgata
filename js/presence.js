/**
 * Contador de usuarios activos (presencia por heartbeat).
 * Requiere un Feature Layer público con edición Add+Update:
 *   - session_id (esriFieldTypeString, 64)
 *   - last_seen  (esriFieldTypeDate)
 */
(function (global) {
  function createPresence(config, esriRequest) {
    const cfg = config && config.presence;
    if (!cfg || !cfg.layer) {
      return { start() {}, stop() {} };
    }

    const layerUrl = cfg.layer.replace(/\/$/, "");
    const heartbeatMs = cfg.heartbeatMs || 25000;
    const activeMinutes = cfg.activeMinutes || 2;
    const sessionKey = "cabalgata_presence_sid";

    let sessionId = sessionStorage.getItem(sessionKey);
    if (!sessionId) {
      sessionId =
        "s_" +
        Math.random().toString(36).slice(2) +
        "_" +
        Date.now().toString(36);
      sessionStorage.setItem(sessionKey, sessionId);
    }

    let objectId = null;
    let timer = null;
    let stopped = false;
    const onCount = typeof cfg.onCount === "function" ? cfg.onCount : () => {};

    async function applyEdits(adds, updates) {
      const form = new URLSearchParams();
      form.set("f", "json");
      form.set("adds", JSON.stringify(adds || []));
      form.set("updates", JSON.stringify(updates || []));
      const res = await esriRequest(layerUrl + "/applyEdits", {
        responseType: "json",
        method: "post",
        body: form
      });
      return res.data;
    }

    async function ensureSession() {
      const now = Date.now();
      if (objectId != null) {
        await applyEdits(null, [
          {
            attributes: {
              OBJECTID: objectId,
              session_id: sessionId,
              last_seen: now
            }
          }
        ]);
        return;
      }

      // Buscar sesión existente (misma pestaña / sessionStorage)
      const where = encodeURIComponent(`session_id='${sessionId}'`);
      const findUrl =
        layerUrl +
        `/query?where=${where}&outFields=OBJECTID,session_id,last_seen&returnGeometry=false&f=json`;
      const found = await esriRequest(findUrl, { responseType: "json" });
      const feat = (found.data.features || [])[0];
      if (feat) {
        objectId = feat.attributes.OBJECTID;
        await applyEdits(null, [
          {
            attributes: {
              OBJECTID: objectId,
              session_id: sessionId,
              last_seen: now
            }
          }
        ]);
        return;
      }

      const added = await applyEdits(
        [
          {
            attributes: {
              session_id: sessionId,
              last_seen: now
            }
          }
        ],
        null
      );
      const resAdd = (added.addResults || [])[0];
      if (resAdd && resAdd.success) {
        objectId = resAdd.objectId;
      }
    }

    async function countActive() {
      const cutoff = Date.now() - activeMinutes * 60 * 1000;
      // last_seen en epoch ms (hosted feature layers suelen usar epoch)
      const where = encodeURIComponent(`last_seen >= ${cutoff}`);
      const url =
        layerUrl +
        `/query?where=${where}&returnCountOnly=true&f=json`;
      const res = await esriRequest(url, { responseType: "json" });
      let n = res.data.count;
      if (typeof n !== "number") {
        // Fallback: listar y contar
        const listUrl =
          layerUrl +
          `/query?where=${where}&outFields=OBJECTID&returnGeometry=false&f=json`;
        const list = await esriRequest(listUrl, { responseType: "json" });
        n = (list.data.features || []).length;
      }
      onCount(Math.max(1, n || 1));
    }

    async function tick() {
      if (stopped) return;
      try {
        await ensureSession();
        await countActive();
      } catch (err) {
        console.warn("presence", err);
      }
    }

    function start() {
      stopped = false;
      tick();
      timer = setInterval(tick, heartbeatMs);
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("pagehide", stop);
    }

    function onVis() {
      if (!document.hidden) tick();
    }

    function stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", stop);
    }

    return { start, stop };
  }

  global.CabalgataPresence = { createPresence };
})(window);
