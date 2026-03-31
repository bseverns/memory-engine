(function initMemoryEngineRevocation(doc) {
  const form = doc.getElementById("revokeForm");
  const tokenInput = doc.getElementById("token");
  const submitButton = doc.getElementById("revokeSubmit");
  const statusNode = doc.getElementById("revokeStatus");

  if (!form || !tokenInput || !submitButton || !statusNode) return;

  function normalizeToken(value) {
    return String(value || "").trim().toUpperCase();
  }

  function setStatus(kind, title, detail) {
    statusNode.hidden = false;
    statusNode.className = `component-card revoke-status ${kind}`;
    statusNode.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
  }

  function setBusy(isBusy) {
    tokenInput.disabled = isBusy;
    submitButton.disabled = isBusy;
    submitButton.textContent = isBusy ? "Revoking..." : "Revoke with this code";
  }

  tokenInput.value = normalizeToken(tokenInput.value);
  tokenInput.addEventListener("blur", () => {
    tokenInput.value = normalizeToken(tokenInput.value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = normalizeToken(tokenInput.value);
    tokenInput.value = token;

    if (!token) {
      setStatus("degraded", "Receipt code needed", "Enter the revocation code from the receipt before trying again.");
      tokenInput.focus();
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/v1/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ token }),
      });

      let payload = {};
      try {
        payload = await response.json();
      } catch (err) {}

      if (response.ok) {
        const revokedCount = Number(payload.revoked_artifacts || 0);
        if (revokedCount > 0) {
          setStatus(
            "ready",
            "Recording removed",
            revokedCount === 1
              ? "The saved recording tied to this code was removed from this node."
              : `${revokedCount} saved recordings tied to this code were removed from this node.`,
          );
        } else {
          setStatus(
            "degraded",
            "Nothing active remained",
            "This code was valid, but there were no active saved recordings left to remove on this node.",
          );
        }
        form.reset();
        tokenInput.value = "";
        return;
      }

      if (response.status === 404) {
        setStatus("broken", "Code not found", "That receipt code was not found on this node. Check the code and try again.");
        return;
      }

      if (response.status === 429) {
        setStatus("degraded", "Please wait a moment", "This node is asking for a short pause before another revocation attempt.");
        return;
      }

      if (response.status === 400) {
        setStatus("degraded", "Receipt code needed", "Enter the revocation code from the receipt before trying again.");
        return;
      }

      setStatus(
        "broken",
        "Revocation did not complete",
        payload.error || `The node returned ${response.status}. Try again in a moment or ask a steward for help.`,
      );
    } catch (err) {
      setStatus("broken", "Cannot reach this node", "The revocation page could not reach the local API. Check that this node is still available on the network.");
    } finally {
      setBusy(false);
    }
  });
})(document);
