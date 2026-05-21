export type SystemStats = {
  employees: number;
  departments: number;
  doors: number;
  today_logs: number;
};

export type Employee = {
  id: number;
  full_name: string;
  employee_code: string;
  role?: string;
  is_active: boolean;
  department_id?: number | null;
};

export type Door = {
  id: number;
  name: string;
  description?: string | null;
};

export type Department = {
  id: number;
  name: string;
};

export type AttendanceLog = {
  id: number;
  employee_id: number | null;
  door_id: number | null;
  checkin_at: string;
  status: "SUCCESS" | "DENIED" | "UNKNOWN" | string;
  reason?: string | null;
  image_snapshot?: string | null;
};

export type IdentifyResult = {
  match: boolean;
  employee_name?: string;
  employee_code?: string;
  open_door: boolean;
  message: string;
  score?: number;
  images_processed?: number;
};

export type MonthlyStats = {
  month: number;
  year: number;
  total_records: number;
  data: Array<Record<string, unknown>>;
};

export type BulkImportSummary = {
  success?: number;
  errors?: number;
  no_images?: number;
};

export type BulkImportDetail = {
  code?: string;
  status?: string;
  images?: number;
  message?: string;
};

export type BulkImportResponse = {
  message: string;
  details?: BulkImportDetail[];
  summary?: BulkImportSummary;
};
