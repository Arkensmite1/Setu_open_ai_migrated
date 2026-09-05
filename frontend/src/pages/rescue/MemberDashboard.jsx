import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertOctagon, Crosshair, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel, SectionHeading } from "@/components/common/GovUI";
import { LocationQuality, PriorityBadge, SafetyNote, StateBadge, StateTracker } from "@/components/setu/SetuBits";
import { apiError, setuApi, setuEndpoints } from "@/lib/setuApi";
import { acquireLocation } from "@/lib/offlineQueue";

const REJECT_REASONS = [
  ["EQUIPMENT_UNAVAILABLE", "Equipment unavailable"],
  ["ALREADY_ENGAGED", "Already engaged on another case"],
  ["ROUTE_INACCESSIBLE", "Route inaccessible"],
  ["TOO_FAR", "Too far to reach in time"],
  ["UNSAFE_CONDITIONS", "Unsafe conditions"],
  ["OTHER", "Other"],
];

const NEXT_ACTIONS = {
  ACCEPTED: [["EN_ROUTE", "Start moving (EN_ROUTE)"]],
  EN_ROUTE: [["ARRIVED", "Reached the location (ARRIVED)"]],
  ARRIVED: [
    ["RESCUING", "Person(s) found — start rescue"],
    ["SEARCHING", "Not visible — start search"],
    ["USER_NOT_FOUND", "Person not found here"],
    ["ALREADY_RESCUED", "Already rescued by another team"],
  ],
  RESCUING: [["RESCUED", "Rescue complete — people safe"], ["SEARCHING", "Switch to search"]],
  SEARCHING: [["RESCUING", "Found — start rescue"], ["RESCUED", "People safe"], ["NOT_FOUND", "Search closed — not found"]],
  USER_NOT_FOUND: [["SEARCHING", "Begin area search"], ["NOT_FOUND", "Search closed — not found"]],
};

const field = "w-full px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:border-national";

const formatLatLng = (loc) => {
  if (!loc || loc.latitude === undefined || loc.longitude === undefined) return "Location unavailable";
  return `${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}`;
};

const formatTimestamp = (value) => {
  if (!value) return "Waiting for update";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Waiting for update";
  return d.toLocaleString();
};

export default function MemberDashboard() {
  const [teamId, setTeamId] = useState(null);
  const [cases, setCases] = useState([]);
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(null);
  const [reason, setReason] = useState("EQUIPMENT_UNAVAILABLE");
  const [completing, setCompleting] = useState(null);
  const [report, setReport] = useState({
    peopleRescued: 0, injuredTransported: 0, fatalities: 0, handedOverTo: "",
    victimConfirmation: true, victimConfirmationWaivedReason: "", observations: "",
  });
  const [road, setRoad] = useState("");

  // NEW: holds { s, status, label } for the confirmation popup
  const [confirmAction, setConfirmAction] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data } = await setuApi.get(setuEndpoints.assignedToMe);
      setTeamId(data.teamId);
      setCases(data.sos || []);
      if (!data.teamId && data.note) toast.info(data.note);
    } catch (e) {
      toast.error(apiError(e, "Could not load your assignments"));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (sosId, fn, successMsg) => {
    try {
      await fn();
      toast.success(successMsg);
      load();
    } catch (e) {
      toast.error(apiError(e, "Action failed"));
      load();
    }
  };

  const accept = (s) =>
    act(s.sosId, () => setuApi.post(setuEndpoints.sosAccept(s.sosId)), "Assignment accepted");

  const setStatus = (s, status) =>
    act(s.sosId, async () => {
      const loc = await acquireLocation();
      await setuApi.post(setuEndpoints.sosStatus(s.sosId), {
        status, note: note || null,
        location: loc
          ? { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
              source: loc.source, timestamp: loc.timestamp }
          : null,
      });
      setNote("");
    }, `Status updated to ${status.replace(/_/g, " ")}`);

  const doReject = (s) =>
    act(s.sosId, async () => {
      await setuApi.post(setuEndpoints.sosReject(s.sosId), { reason, note: note || null });
      setRejecting(null);
      setNote("");
    }, "Assignment rejected — case returned to the leader for reassignment");

  const submitReport = (s) =>
    act(s.sosId, async () => {
      await setuApi.post(setuEndpoints.sosComplete(s.sosId), {
        ...report,
        peopleRescued: Number(report.peopleRescued) || 0,
        injuredTransported: Number(report.injuredTransported) || 0,
        fatalities: Number(report.fatalities) || 0,
        handedOverTo: report.handedOverTo || null,
        victimConfirmationWaivedReason: report.victimConfirmation
          ? null
          : report.victimConfirmationWaivedReason || "Victim unable to confirm",
      });
      setCompleting(null);
    }, "Case completed — live location sharing stopped");

  const pingLocation = async () => {
    if (!teamId) return;
    const loc = await acquireLocation();
    if (!loc) return toast.error("Location unavailable");
    try {
      await setuApi.post(setuEndpoints.teamLocation(teamId), {
        location: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
                    source: loc.source, timestamp: loc.timestamp },
      });
      toast.success("Team location updated");
    } catch (e) {
      toast.error(apiError(e, "Could not update location"));
    }
  };

  const reportRoad = async () => {
    if (!road.trim()) return toast.error("Describe the blockage");
    const loc = await acquireLocation();
    if (!loc) return toast.error("Location unavailable");
    try {
      const { data } = await setuApi.post(setuEndpoints.blockedRoad, {
        location: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy,
                    source: loc.source, timestamp: loc.timestamp },
        description: road.trim(),
      });
      toast.success(`Reported — ${data.teamsNotified.length} nearby team(s) notified`);
      setRoad("");
    } catch (e) {
      toast.error(apiError(e, "Could not report the blockage"));
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-4 py-6 space-y-6">
      <SectionHeading
        eyebrow="Field operations"
        title="Rescue Member dashboard"
        description={teamId ? `Team ${teamId} — you see only the emergencies assigned to your team.`
                            : "You are not linked to a team yet."}
        action={
          <div className="flex gap-2">
            <Button onClick={pingLocation} data-testid="member-ping-location"
                    className="bg-white border border-slate-300 text-slate-700 gap-2 h-9 text-xs">
              <Crosshair size={14} /> Update my location
            </Button>
            <Button onClick={load} data-testid="member-refresh"
                    className="bg-national text-white gap-2 h-9 text-xs">
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        }
      />

      {!cases.length && (
        <SafetyNote>
          No emergency is currently assigned to your team. Standing by does not mean there is no
          emergency — keep your status and location up to date.
        </SafetyNote>
      )}

      <div className="space-y-4">
        {cases.map((s) => (
          <Panel key={s.sosId} title={`${s.sosId} — ${s.emergencyType}`}
                 action={<PriorityBadge priority={s.priority} />}>
            <div className="grid lg:grid-cols-3 gap-4" data-testid={`assignment-${s.sosId}`}>
              <div className="lg:col-span-2 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StateBadge status={s.status} />
                  <span className="text-xs text-slate-600">
                    {s.peopleCount} people • {s.injuredCount} injured
                    {s.childrenCount ? ` • ${s.childrenCount} children` : ""}
                    {s.elderlyCount ? ` • ${s.elderlyCount} elderly` : ""}
                  </span>
                </div>
                <StateTracker status={s.status} />
                {s.description && <p className="text-sm text-slate-700">“{s.description}”</p>}
                {s.accessibilityRequirement && (
                  <p className="text-xs text-slate-700">
                    Accessibility: <strong>{s.accessibilityRequirement}</strong>
                  </p>
                )}
                {s.landmark && <p className="text-xs text-slate-700">Landmark: <strong>{s.landmark}</strong></p>}
                <div className="text-xs text-slate-600">
                  Origin: {s.origin?.latitude?.toFixed(5)}, {s.origin?.longitude?.toFixed(5)}
                  {s.lastKnown && (s.lastKnown.latitude !== s.origin?.latitude ||
                                   s.lastKnown.longitude !== s.origin?.longitude) && (
                    <> • last known: {s.lastKnown.latitude.toFixed(5)}, {s.lastKnown.longitude.toFixed(5)}</>
                  )}
                </div>
                <LocationQuality quality={s.locationQuality} />
                {s.liveTrackingActive ? (
                  <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">
                       {s.trackingLabel || "Citizen live location"}
                      </span>
                      <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                       LIVE
                      </span>
                    </div>
                    <div className="mt-2 text-sm text-slate-700">
                      Citizen location: <strong>{formatLatLng(s.counterpartLocation)}</strong>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Last updated: {formatTimestamp(s.counterpartLocation?.timestamp)}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                    Live tracking is waiting for an active assignment.
                  </div>
                )}
                <input className={field} placeholder="Field note (optional, stored in the audit log)"
                       value={note} onChange={(e) => setNote(e.target.value)} />
              </div>

              <div className="space-y-2">
                {s.status === "ASSIGNED" && (
                  <>
                    <Button onClick={() => accept(s)} data-testid={`accept-${s.sosId}`}
                            className="w-full bg-national text-white">Accept assignment</Button>
                    <Button onClick={() => setRejecting(rejecting === s.sosId ? null : s.sosId)}
                            data-testid={`reject-toggle-${s.sosId}`}
                            className="w-full bg-white border border-slate-300 text-slate-700">
                      Cannot take this case
                    </Button>
                    {rejecting === s.sosId && (
                      <div className="space-y-2">
                        <select className={field} value={reason} onChange={(e) => setReason(e.target.value)}
                                data-testid={`reject-reason-${s.sosId}`}>
                          {REJECT_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <Button onClick={() => doReject(s)} data-testid={`reject-confirm-${s.sosId}`}
                                className="w-full text-white" style={{ backgroundColor: "#C62828" }}>
                          Submit rejection
                        </Button>
                      </div>
                    )}
                  </>
                )}
                {/* CHANGED: status buttons open the confirmation popup instead of calling setStatus directly */}
                {(NEXT_ACTIONS[s.status] || []).map(([status, label]) => (
                  <Button key={status}
                          onClick={() => setConfirmAction({ s, status, label })}
                          data-testid={`status-${status}-${s.sosId}`}
                          className="w-full bg-national text-white text-xs">
                    {label}
                  </Button>
                ))}
                {["RESCUED", "NOT_FOUND", "ALREADY_RESCUED", "FALSE_ALARM"].includes(s.status) && (
                  <Button onClick={() => setCompleting(completing === s.sosId ? null : s.sosId)}
                          data-testid={`complete-toggle-${s.sosId}`}
                          className="w-full text-white" style={{ backgroundColor: "#138808" }}>
                    Submit rescue report
                  </Button>
                )}
                {/* CHANGED: false-alarm also opens the same confirmation popup */}
                {["ARRIVED", "RESCUING", "SEARCHING"].includes(s.status) && (
                  <Button onClick={() => setConfirmAction({ s, status: "FALSE_ALARM", label: "No emergency found (false SOS)" })}
                          data-testid={`false-alarm-${s.sosId}`}
                          className="w-full bg-white border border-slate-300 text-slate-700 text-xs">
                    No emergency found (false SOS)
                  </Button>
                )}
              </div>
            </div>

            {completing === s.sosId && (
              <div className="mt-4 border-t border-slate-200 pt-4 grid sm:grid-cols-2 gap-2"
                   data-testid={`completion-form-${s.sosId}`}>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  People rescued
                  <input type="number" min={0} className={`${field} mt-1`} value={report.peopleRescued}
                         data-testid={`report-people-${s.sosId}`}
                         onChange={(e) => setReport({ ...report, peopleRescued: e.target.value })} />
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Injured transported
                  <input type="number" min={0} className={`${field} mt-1`} value={report.injuredTransported}
                         onChange={(e) => setReport({ ...report, injuredTransported: e.target.value })} />
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Fatalities
                  <input type="number" min={0} className={`${field} mt-1`} value={report.fatalities}
                         onChange={(e) => setReport({ ...report, fatalities: e.target.value })} />
                </label>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500">
                  Handed over to
                  <input className={`${field} mt-1`} placeholder="Shelter SH-S1 / District hospital"
                         value={report.handedOverTo}
                         onChange={(e) => setReport({ ...report, handedOverTo: e.target.value })} />
                </label>
                <label className="text-xs text-slate-600 sm:col-span-2 flex items-center gap-2">
                  <input type="checkbox" checked={report.victimConfirmation}
                         data-testid={`report-confirmation-${s.sosId}`}
                         onChange={(e) => setReport({ ...report, victimConfirmation: e.target.checked })} />
                  Person(s) were able to confirm the rescue themselves
                </label>
                {!report.victimConfirmation && (
                  <input className={`${field} sm:col-span-2`}
                         placeholder="Why confirmation was not possible (e.g. victim unconscious)"
                         value={report.victimConfirmationWaivedReason}
                         onChange={(e) => setReport({ ...report, victimConfirmationWaivedReason: e.target.value })} />
                )}
                <textarea rows={2} className={`${field} sm:col-span-2`} placeholder="Observations"
                          value={report.observations}
                          onChange={(e) => setReport({ ...report, observations: e.target.value })} />
                <Button onClick={() => submitReport(s)} data-testid={`report-submit-${s.sosId}`}
                        className="sm:col-span-2 bg-national text-white">
                  Submit report and close case
                </Button>
              </div>
            )}
          </Panel>
        ))}
      </div>

      <Panel title="Report a blocked road" action={<AlertOctagon size={14} style={{ color: "#C62828" }} />}>
        <div className="flex flex-col sm:flex-row gap-2">
          <input className={field} data-testid="blocked-road-input"
                 placeholder="Bridge submerged near Silapathar approach road"
                 value={road} onChange={(e) => setRoad(e.target.value)} />
          <Button onClick={reportRoad} data-testid="blocked-road-submit"
                  className="bg-national text-white shrink-0">Report</Button>
        </div>
        <p className="text-[11px] text-slate-500 mt-2">
          Nearby teams are notified and routes are recalculated as advisory suggestions only.
        </p>
      </Panel>

      {/* NEW: confirmation popup with clean, scrollable case summary */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-national">
                Confirm: {confirmAction.label}
              </h3>
              <button
                className="text-slate-400 hover:text-slate-600 text-lg leading-none"
                onClick={() => setConfirmAction(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{confirmAction.s.sosId}</span>
                <StateBadge status={confirmAction.s.status} />
                <PriorityBadge priority={confirmAction.s.priority} />
              </div>

              <div className="text-xs text-slate-600">
                {confirmAction.s.peopleCount} people • {confirmAction.s.injuredCount} injured
                {confirmAction.s.childrenCount ? ` • ${confirmAction.s.childrenCount} children` : ""}
                {confirmAction.s.elderlyCount ? ` • ${confirmAction.s.elderlyCount} elderly` : ""}
              </div>

              {confirmAction.s.description && (
                <p className="text-sm text-slate-700 italic">“{confirmAction.s.description}”</p>
              )}

              {confirmAction.s.accessibilityRequirement && (
                <p className="text-xs text-slate-700">
                  Accessibility: <strong>{confirmAction.s.accessibilityRequirement}</strong>
                </p>
              )}

              {confirmAction.s.landmark && (
                <p className="text-xs text-slate-700">
                  Landmark: <strong>{confirmAction.s.landmark}</strong>
                </p>
              )}

              <div className="text-xs text-slate-600">
                Origin: {confirmAction.s.origin?.latitude?.toFixed(5)}, {confirmAction.s.origin?.longitude?.toFixed(5)}
                {confirmAction.s.lastKnown &&
                  (confirmAction.s.lastKnown.latitude !== confirmAction.s.origin?.latitude ||
                   confirmAction.s.lastKnown.longitude !== confirmAction.s.origin?.longitude) && (
                  <> • last known: {confirmAction.s.lastKnown.latitude.toFixed(5)}, {confirmAction.s.lastKnown.longitude.toFixed(5)}</>
                )}
              </div>

              <LocationQuality quality={confirmAction.s.locationQuality} />

              {confirmAction.s.liveTrackingActive ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-[0.12em] text-emerald-700">
                      {confirmAction.s.trackingLabel || "Citizen live location"}
                    </span>
                    <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                      LIVE
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    Citizen location: <strong>{formatLatLng(confirmAction.s.counterpartLocation)}</strong>
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    Last updated: {formatTimestamp(confirmAction.s.counterpartLocation?.timestamp)}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                  Live tracking is waiting for an active assignment.
                </div>
              )}

              {note && (
                <div className="text-xs text-slate-600 border-t border-slate-100 pt-3">
                  Field note to be saved: <span className="italic">“{note}”</span>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-5 py-3 flex justify-end gap-2">
              <button
                className="h-8 px-3 text-xs rounded-md border border-slate-300 text-slate-600"
                onClick={() => setConfirmAction(null)}
              >
                Cancel
              </button>
              <Button
                className="h-8 text-xs bg-national text-white"
                data-testid="confirm-status-action"
                onClick={() => {
                  const { s, status } = confirmAction;
                  setConfirmAction(null);
                  setStatus(s, status); // SAME function, SAME behavior as before
                }}
              >
                Confirm — {confirmAction.label}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
