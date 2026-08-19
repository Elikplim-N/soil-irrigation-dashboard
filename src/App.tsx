// src/App.tsx
import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "./lib/supabase";
import type { TelemetryData, SystemConfig } from "./types";
import { Card } from "./components/Card";
import { MoistureTankChart, EnvironmentChart } from "./components/Charts";

const POLL_MS = 5000;
const GH_TZ = "Africa/Accra";

export default function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "collection">("dashboard");
  const [readings, setReadings] = useState<TelemetryData[]>([]);
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loadingReadings, setLoadingReadings] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [submittingConfig, setSubmittingConfig] = useState(false);
  const [submittingSoilType, setSubmittingSoilType] = useState(false);

  // Form states for config
  const [pumpCommand, setPumpCommand] = useState<"AUTO" | "ON" | "OFF">("AUTO");
  const [drySoilThreshold, setDrySoilThreshold] = useState(35);
  const [tankEmptyCm, setTankEmptyCm] = useState(120);
  const [adminPhone, setAdminPhone] = useState("+233241025197");
  const [reminderIntervalHours, setReminderIntervalHours] = useState(24);
  const [alertMoistureLevel, setAlertMoistureLevel] = useState(30);
  const [activeSoilType, setActiveSoilType] = useState<string>("Default");

  // Fetch Telemetry Data
  async function fetchReadings() {
    const { data, error } = await supabase
      .from("sensor_readings")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000); // Fetch complete history

    if (!error && data) {
      setReadings(data as TelemetryData[]);
    }
    setLoadingReadings(false);
  }

  // Fetch Config
  async function fetchConfig() {
    const { data, error } = await supabase
      .from("system_configs")
      .select("*")
      .eq("id", 1)
      .single();

    if (!error && data) {
      const cfg = data as SystemConfig;
      setConfig(cfg);
      setPumpCommand(cfg.pump_command);
      setDrySoilThreshold(cfg.dry_soil_threshold);
      setTankEmptyCm(cfg.tank_empty_cm);
      setAdminPhone(cfg.admin_phone);
      setReminderIntervalHours(cfg.reminder_interval_hours);
      setAlertMoistureLevel(cfg.alert_moisture_level);
      setActiveSoilType(cfg.active_soil_type ?? "Default");
    } else if (error && error.code === "PGRST116") {
      // Configuration row not created yet, let's create a default row
      const defaultCfg = {
        id: 1,
        pump_command: "AUTO",
        dry_soil_threshold: 35,
        tank_empty_cm: 120,
        admin_phone: "+233241025197",
        reminder_interval_hours: 24,
        alert_moisture_level: 30,
        active_soil_type: "Default",
      };
      await supabase.from("system_configs").insert([defaultCfg]);
      setConfig(defaultCfg as SystemConfig);
    }
    setLoadingConfig(false);
  }

  // Update Config on DB
  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingConfig(true);

    const updated = {
      pump_command: pumpCommand,
      dry_soil_threshold: drySoilThreshold,
      tank_empty_cm: tankEmptyCm,
      admin_phone: adminPhone,
      reminder_interval_hours: reminderIntervalHours,
      alert_moisture_level: alertMoistureLevel,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("system_configs")
      .update(updated)
      .eq("id", 1);

    if (!error) {
      fetchConfig();
    }
    setSubmittingConfig(false);
  }

  // Save the currently targeted soil type for active data collection session
  async function handleUpdateSoilType(soil: string) {
    setSubmittingSoilType(true);
    setActiveSoilType(soil);
    const { error } = await supabase
      .from("system_configs")
      .update({ active_soil_type: soil, updated_at: new Date().toISOString() })
      .eq("id", 1);

    if (!error) {
      fetchConfig();
    }
    setSubmittingSoilType(false);
  }

  // Quick command update for Pump control buttons
  async function updatePumpCommand(cmd: "AUTO" | "ON" | "OFF") {
    setPumpCommand(cmd);
    const { error } = await supabase
      .from("system_configs")
      .update({ pump_command: cmd, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (!error) {
      fetchConfig();
    }
  }

  // Export Data to CSV
  function exportToCSV() {
    const headers = [
      "Timestamp (Accra)",
      "Soil Moisture (%)",
      "Soil Temp (C)",
      "Air Temp (C)",
      "Air Humidity (%)",
      "Tank Distance (cm)",
      "Pump State",
      "Battery (V)",
      "Soil Type"
    ];
    const rows = readings.map((r) => [
      formatCreatedAt(r.created_at),
      r.soil_moisture ?? "—",
      r.soil_temp ?? "—",
      r.air_temp ?? "—",
      r.air_humidity ?? "—",
      r.tank_distance_cm ?? "—",
      r.pump_state ? "ON" : "OFF",
      r.battery_voltage ?? "—",
      r.soil_type ?? "Default"
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `irrigation_telemetry_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  useEffect(() => {
    fetchReadings();
    fetchConfig();

    const interval = setInterval(() => {
      fetchReadings();
    }, POLL_MS);

    return () => clearInterval(interval);
  }, []);

  const latest = readings[0];

  // Helper for formatting timestamps
  const formatCreatedAt = (createdAt: string) =>
    new Date(createdAt).toLocaleString("en-GB", {
      timeZone: GH_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  // Calculate Tank fullness percentage
  const getTankPercentage = () => {
    if (!latest || latest.tank_distance_cm <= 0) return 0;
    const maxVal = tankEmptyCm;
    const minVal = 20; // assumed full
    const dist = Math.min(Math.max(latest.tank_distance_cm, minVal), maxVal);
    const percentage = ((maxVal - dist) / (maxVal - minVal)) * 100;
    return Math.round(percentage);
  };

  // Water Volume Calculation
  const activeReadingsCount = readings.filter(r => r.pump_state).length;
  const flowRateLitrePerMin = 3.5;
  const standardMinutesPerCycle = 15;
  const totalWaterLiters = activeReadingsCount * standardMinutesPerCycle * flowRateLitrePerMin;

  // Academic Soil Data Metrics Aggregator
  const soilStats = useMemo(() => {
    const types = ["Loamy", "Sandy", "Clay", "Default"];
    return types.map((type) => {
      const filtered = readings.filter((r) => (r.soil_type ?? "Default") === type);
      const count = filtered.length;
      if (count === 0) {
        return { type, avgMoisture: 0, avgSoilTemp: 0, count: 0 };
      }
      const sumMoisture = filtered.reduce((acc, curr) => acc + (curr.soil_moisture ?? 0), 0);
      const sumSoilTemp = filtered.reduce((acc, curr) => acc + (curr.soil_temp ?? 0), 0);
      return {
        type,
        avgMoisture: Math.round(sumMoisture / count),
        avgSoilTemp: Number((sumSoilTemp / count).toFixed(1)),
        count,
      };
    });
  }, [readings]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">
              Soil Irrigation & Telemetry System
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Active Monitoring Station | Server Time: Africa/Accra
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Tab navigation buttons */}
            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 mr-2">
              <button
                onClick={() => setActiveTab("dashboard")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "dashboard"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Telemetry Dashboard
              </button>
              <button
                onClick={() => setActiveTab("collection")}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "collection"
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                Data Collection ({activeSoilType})
              </button>
            </div>
            <button
              onClick={exportToCSV}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-md shadow-sm hover:bg-slate-50 focus:outline-none"
            >
              Export Data (CSV)
            </button>
            <button
              onClick={() => {
                fetchReadings();
                fetchConfig();
              }}
              className="px-4 py-2 text-sm font-medium text-white bg-slate-950 border border-slate-950 rounded-md shadow-sm hover:bg-slate-900 focus:outline-none"
            >
              Force Sync
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {activeTab === "dashboard" ? (
          <>
            {/* KPI Row */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Card>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Soil Moisture
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold text-slate-950">
                    {latest?.soil_moisture ?? "—"}%
                  </span>
                  <span className="text-xs text-slate-500">
                    / {config?.dry_soil_threshold ?? 35}% Min Limit
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500 font-medium">
                  Soil Classification: <span className="text-slate-900">{latest?.soil_type ?? "Default"}</span>
                </div>
              </Card>

              <Card>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Water Tank Level
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold text-slate-950">
                    {getTankPercentage()}%
                  </span>
                  <span className="text-xs text-slate-500">
                    ({latest?.tank_distance_cm ? `${latest.tank_distance_cm.toFixed(1)} cm` : "—"})
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {latest && latest.tank_distance_cm > (config?.tank_empty_cm ?? 120) ? (
                    <span className="text-red-600 font-medium">Critical: Tank Empty</span>
                  ) : (
                    <span className="text-emerald-600 font-medium">Tank Level Normal</span>
                  )}
                </div>
              </Card>

              <Card>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Pump System State
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className={`text-xl font-semibold ${latest?.pump_state ? "text-emerald-600" : "text-slate-500"}`}>
                    {latest?.pump_state ? "Active (Pumping)" : "Idle (Off)"}
                  </span>
                </div>
                <div className="mt-2 flex gap-1">
                  <button
                    onClick={() => updatePumpCommand("AUTO")}
                    className={`flex-1 text-[10px] font-semibold py-1 rounded border transition-all ${
                      pumpCommand === "AUTO"
                        ? "bg-slate-900 border-slate-900 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Auto
                  </button>
                  <button
                    onClick={() => updatePumpCommand("ON")}
                    className={`flex-1 text-[10px] font-semibold py-1 rounded border transition-all ${
                      pumpCommand === "ON"
                        ? "bg-emerald-600 border-emerald-600 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    On
                  </button>
                  <button
                    onClick={() => updatePumpCommand("OFF")}
                    className={`flex-1 text-[10px] font-semibold py-1 rounded border transition-all ${
                      pumpCommand === "OFF"
                        ? "bg-rose-600 border-rose-600 text-white"
                        : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Off
                  </button>
                </div>
              </Card>

              <Card>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Total Water Applied
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold text-slate-950">
                    {totalWaterLiters.toFixed(1)} L
                  </span>
                  <span className="text-xs text-slate-500">
                    ({activeReadingsCount} cycles)
                  </span>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  <span className="text-slate-500">Avg. 52.5L applied per activation</span>
                </div>
              </Card>

              <Card>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                  Auxiliary Node Stats
                </div>
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-500">Soil/Air Temp:</span>
                    <span className="text-xs font-semibold text-slate-900">
                      {latest?.soil_temp ?? "—"}°C / {latest?.air_temp ?? "—"}°C
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-slate-500">Humidity/Bat:</span>
                    <span className="text-xs font-semibold text-slate-900">
                      {latest?.air_humidity ?? "—"}% / {latest?.battery_voltage ?? "—"}V
                    </span>
                  </div>
                </div>
              </Card>
            </div>

            {/* Charts & Configuration Split */}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-6">
                <Card title="Moisture & Water Level Trends">
                  <MoistureTankChart data={readings.slice(0, 100)} />
                </Card>
                <Card title="Environmental Metrics (Temperature & Humidity)">
                  <EnvironmentChart data={readings.slice(0, 100)} />
                </Card>
              </div>

              <div className="space-y-6">
                {/* System Threshold and Notification Config */}
                <Card title="System Parameters & Alerts">
                  {loadingConfig ? (
                    <div className="text-sm text-slate-500 py-4">Loading system configs...</div>
                  ) : (
                    <form onSubmit={handleSaveConfig} className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">
                          Dry Soil Moisture Threshold (%)
                        </label>
                        <input
                          type="number"
                          value={drySoilThreshold}
                          onChange={(e) => setDrySoilThreshold(Number(e.target.value))}
                          className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">
                          Activates the pump in Auto mode if reading falls below this.
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">
                          Critical Tank Height (cm)
                        </label>
                        <input
                          type="number"
                          value={tankEmptyCm}
                          onChange={(e) => setTankEmptyCm(Number(e.target.value))}
                          className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                        <p className="text-[10px] text-slate-400 mt-1">
                          Distance representing an empty tank (stops the pump immediately).
                        </p>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">
                          SMS Recipient Number
                        </label>
                        <input
                          type="text"
                          value={adminPhone}
                          onChange={(e) => setAdminPhone(e.target.value)}
                          className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">
                          Water Reminder Interval (hours)
                        </label>
                        <input
                          type="number"
                          value={reminderIntervalHours}
                          onChange={(e) => setReminderIntervalHours(Number(e.target.value))}
                          className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">
                          Alert Moisture Level Threshold (%)
                        </label>
                        <input
                          type="number"
                          value={alertMoistureLevel}
                          onChange={(e) => setAlertMoistureLevel(Number(e.target.value))}
                          className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={submittingConfig}
                        className="w-full px-4 py-2 text-sm font-semibold text-white bg-slate-900 border border-transparent rounded-md shadow-sm hover:bg-slate-800 disabled:opacity-50 transition-all"
                      >
                        {submittingConfig ? "Saving..." : "Save Parameters"}
                      </button>
                    </form>
                  )}
                </Card>
              </div>
            </div>

            {/* Telemetry Logs */}
            <Card title="Station Activity Logs">
              <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-80 overflow-y-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-left font-medium text-slate-500 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-4 py-3 bg-slate-50">Timestamp (Accra)</th>
                      <th className="px-4 py-3 bg-slate-50">Soil Moisture (%)</th>
                      <th className="px-4 py-3 bg-slate-50">Soil Temp</th>
                      <th className="px-4 py-3 bg-slate-50">Air Temp / Hum</th>
                      <th className="px-4 py-3 bg-slate-50">Tank (cm)</th>
                      <th className="px-4 py-3 bg-slate-50">Pump</th>
                      <th className="px-4 py-3 bg-slate-50">Soil Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {readings.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-2 font-mono">{formatCreatedAt(r.created_at)}</td>
                        <td className="px-4 py-2 font-medium">{r.soil_moisture ?? "—"}%</td>
                        <td className="px-4 py-2">{r.soil_temp ?? "—"}°C</td>
                        <td className="px-4 py-2">
                          {r.air_temp ?? "—"}°C / {r.air_humidity ?? "—"}%
                        </td>
                        <td className="px-4 py-2">{r.tank_distance_cm ? `${r.tank_distance_cm.toFixed(1)} cm` : "—"}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded font-semibold text-[10px] ${r.pump_state ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                            {r.pump_state ? "ON" : "OFF"}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-medium">{r.soil_type ?? "Default"}</td>
                      </tr>
                    ))}
                    {readings.length === 0 && !loadingReadings && (
                      <tr>
                        <td className="px-4 py-4 text-center text-slate-400" colSpan={7}>
                          No recent telemetry received.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-6 md:grid-cols-3">
              {/* Soil Type Controller Card */}
              <Card title="Active Data Collection Session">
                <p className="text-sm text-slate-500 mb-4">
                  Select the soil profile currently loaded in the telemetry testbed to tag incoming samples.
                </p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Target Soil Profile
                    </label>
                    <select
                      value={activeSoilType}
                      onChange={(e) => handleUpdateSoilType(e.target.value)}
                      disabled={submittingSoilType}
                      className="mt-1 block w-full px-3 py-2 border border-slate-300 bg-white rounded-md shadow-sm text-sm focus:outline-none focus:ring-1 focus:ring-slate-900"
                    >
                      <option value="Default">Default / Standard</option>
                      <option value="Loamy">Loamy Soil Profile</option>
                      <option value="Sandy">Sandy Soil Profile</option>
                      <option value="Clay">Clay Soil Profile</option>
                    </select>
                  </div>

                  <div className="p-3 bg-slate-100 rounded-md border border-slate-200">
                    <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                      Logging Status
                    </div>
                    <div className="mt-1 text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse"></span>
                      Recording samples for: {activeSoilType}
                    </div>
                  </div>
                </div>
              </Card>

              {/* Aggregated Experimental Summary Table */}
              <div className="md:col-span-2">
                <Card title="Experimental Matrix Summary">
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="min-w-full divide-y divide-slate-200 text-xs">
                      <thead className="bg-slate-50 text-left font-medium text-slate-500">
                        <tr>
                          <th className="px-4 py-3">Soil Profile</th>
                          <th className="px-4 py-3">Samples Logged</th>
                          <th className="px-4 py-3">Average Moisture (%)</th>
                          <th className="px-4 py-3">Average Soil Temp (°C)</th>
                          <th className="px-4 py-3">Hydration Characterization</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {soilStats.map((stat) => (
                          <tr key={stat.type} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-slate-900">{stat.type}</td>
                            <td className="px-4 py-3 font-mono">{stat.count}</td>
                            <td className="px-4 py-3 font-medium text-slate-950">{stat.count > 0 ? `${stat.avgMoisture}%` : "—"}</td>
                            <td className="px-4 py-3">{stat.count > 0 ? `${stat.avgSoilTemp}°C` : "—"}</td>
                            <td className="px-4 py-3">
                              {stat.count === 0 ? (
                                <span className="text-slate-400">No Data</span>
                              ) : stat.avgMoisture > 45 ? (
                                <span className="px-2 py-0.5 bg-sky-50 text-sky-700 rounded font-semibold text-[10px]">High Retention</span>
                              ) : stat.avgMoisture > 30 ? (
                                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded font-semibold text-[10px]">Optimal Retention</span>
                              ) : (
                                <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded font-semibold text-[10px]">Low Retention (Dry)</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            </div>

            {/* Logs filtered for Experimental Types */}
            <Card title="Soil Profile Telemetry Logs">
              <div className="overflow-x-auto border border-slate-200 rounded-lg max-h-96 overflow-y-auto">
                <table className="min-w-full divide-y divide-slate-200 text-xs">
                  <thead className="bg-slate-50 text-left font-medium text-slate-500 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-4 py-3 bg-slate-50">Timestamp (Accra)</th>
                      <th className="px-4 py-3 bg-slate-50">Soil Profile</th>
                      <th className="px-4 py-3 bg-slate-50">Soil Moisture (%)</th>
                      <th className="px-4 py-3 bg-slate-50">Soil Temp</th>
                      <th className="px-4 py-3 bg-slate-50">Air Temp / Hum</th>
                      <th className="px-4 py-3 bg-slate-50">Tank (cm)</th>
                      <th className="px-4 py-3 bg-slate-50">Pump</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {readings
                      .filter(r => r.soil_type && r.soil_type !== "Default")
                      .map((r) => (
                        <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-2 font-mono">{formatCreatedAt(r.created_at)}</td>
                          <td className="px-4 py-2 font-semibold text-slate-900">{r.soil_type}</td>
                          <td className="px-4 py-2 font-medium">{r.soil_moisture ?? "—"}%</td>
                          <td className="px-4 py-2">{r.soil_temp ?? "—"}°C</td>
                          <td className="px-4 py-2">
                            {r.air_temp ?? "—"}°C / {r.air_humidity ?? "—"}%
                          </td>
                          <td className="px-4 py-2">{r.tank_distance_cm ? `${r.tank_distance_cm.toFixed(1)} cm` : "—"}</td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 rounded font-semibold text-[10px] ${r.pump_state ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                              {r.pump_state ? "ON" : "OFF"}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}
      </main>

      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-8 text-center text-xs text-slate-500">
          Smart Irrigation & Soil Telemetry Dashboard — Prepared for Academic Demonstration.
        </div>
      </footer>
    </div>
  );
}
