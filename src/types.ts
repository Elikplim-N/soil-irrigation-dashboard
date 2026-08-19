// src/types.ts
export type TelemetryData = {
  id: string;
  created_at: string;
  node_id: number;
  soil_moisture: number;
  soil_temp: number;
  air_temp: number;
  air_humidity: number;
  battery_voltage: number;
  tank_distance_cm: number;
  pump_state: boolean;
  soil_type: string;
};

export type SystemConfig = {
  id: number;
  pump_command: "AUTO" | "ON" | "OFF";
  dry_soil_threshold: number;
  tank_empty_cm: number;
  admin_phone: string;
  reminder_interval_hours: number;
  alert_moisture_level: number;
  active_soil_type: string;
  updated_at: string;
};
