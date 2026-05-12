import type {
  AttendanceLog,
  Department,
  Door,
  Employee,
  IdentifyResult,
  MonthlyStats,
  SystemStats,
} from "../types";
import {
  mockDepartments,
  mockDoors,
  mockEmployees,
  mockHistory,
  mockIdentifySuccess,
  mockMonthlyStats,
  mockStats,
} from "./mock";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "https://graffiti-fit-error.ngrok-free.dev/api/v1";
const FORCE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

export type ApiMode = "live" | "mock";

let currentMode: ApiMode = FORCE_MOCK ? "mock" : "live";

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function getApiMode() {
  return currentMode;
}

async function request<T>(path: string, fallback: T, init?: RequestInit): Promise<T> {
  if (FORCE_MOCK) {
    currentMode = "mock";
    return fallback;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, init);
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    currentMode = "live";
    return (await response.json()) as T;
  } catch (error) {
    currentMode = "mock";
    console.warn(`API fallback for ${path}`, error);
    return fallback;
  }
}

function jsonRequest(method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): RequestInit {
  return {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const api = {
  health: async () => {
    if (FORCE_MOCK) return { status: "mock" };
    try {
      const rootUrl = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
      const response = await fetch(`${rootUrl}/health`);
      if (!response.ok) throw new Error(`${response.status}`);
      currentMode = "live";
      return (await response.json()) as { status: string };
    } catch {
      currentMode = "mock";
      return { status: "offline" };
    }
  },

  getSystemStats: () => request<SystemStats>("/admin/admin/system-stats", mockStats),

  getEmployees: () => request<Employee[]>("/employees/employees/", mockEmployees),
  searchEmployees: (query: string) =>
    request<Employee[]>(
      `/employees/employees/search?query=${encodeURIComponent(query)}`,
      mockEmployees.filter((employee) => {
        const haystack = `${employee.full_name} ${employee.employee_code}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      }),
    ),
  registerEmployee: (formData: FormData) =>
    request<Employee>("/employees/employees/register", mockEmployees[0], {
      method: "POST",
      body: formData,
    }),
  updateEmployeeStatus: (id: number, isActive: boolean) =>
    request<Employee | null>(
      `/employees/employees/${id}/status?is_active=${isActive}`,
      { ...mockEmployees.find((item) => item.id === id)!, is_active: isActive },
      jsonRequest("PATCH"),
    ),
  deleteEmployee: (id: number) =>
    request<{ status: string; message: string }>(
      `/employees/employees/${id}`,
      { status: "success", message: `Đã xóa nhân viên ID ${id}` },
      jsonRequest("DELETE"),
    ),
  setEmployeePermission: (
    employeeId: number,
    doorId: number,
    allowedStartTime?: string,
    allowedEndTime?: string,
  ) =>
    request<{ status: string }>(
      `/employees/employees/${employeeId}/permissions`,
      { status: "success" },
      jsonRequest("PUT", {
        door_id: doorId,
        allowed_start_time: allowedStartTime || null,
        allowed_end_time: allowedEndTime || null,
      }),
    ),

  getDoors: () => request<Door[]>("/doors/doors/", mockDoors),
  createDoor: (payload: Pick<Door, "name" | "description">) =>
    request<Door>(
      "/doors/doors/",
      { id: Date.now(), ...payload },
      jsonRequest("POST", payload),
    ),

  getDepartments: () => request<Department[]>("/departments/departments/", mockDepartments),
  createDepartment: (name: string) =>
    request<Department>(
      "/departments/departments/",
      { id: Date.now(), name },
      jsonRequest("POST", { name }),
    ),
  setDepartmentPermission: (
    departmentId: number,
    doorId: number,
    allowedStartTime?: string,
    allowedEndTime?: string,
  ) =>
    request<{ id: number }>(
      "/departments/departments/permissions",
      { id: Date.now() },
      jsonRequest("POST", {
        department_id: departmentId,
        door_id: doorId,
        allowed_start_time: allowedStartTime || null,
        allowed_end_time: allowedEndTime || null,
      }),
    ),

  identify: (doorName: string, image: Blob) => {
    const formData = new FormData();
    formData.append("file", image, "capture.jpg");
    return request<IdentifyResult>(
      `/attendance/attendance/identify?door_name=${encodeURIComponent(doorName)}`,
      mockIdentifySuccess,
      {
        method: "POST",
        body: formData,
      },
    );
  },
  getAttendanceHistory: (limit = 100, employeeId?: number) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (employeeId) params.set("employee_id", String(employeeId));
    const fallbackHistory = employeeId
      ? mockHistory.filter((item) => item.employee_id === employeeId)
      : mockHistory;
    return request<AttendanceLog[]>(
      `/attendance/attendance/history?${params.toString()}`,
      fallbackHistory,
    );
  },
  getMonthlyStats: (month: number, year: number) =>
    request<MonthlyStats>(
      `/attendance/attendance/stats/monthly?month=${month}&year=${year}`,
      { ...mockMonthlyStats, month, year },
    ),
  getExcelExportUrl: (month: number, year: number) =>
    `${API_BASE_URL}/attendance/attendance/export/excel?month=${month}&year=${year}`,

  bulkImport: (zipFile: File) => {
    const formData = new FormData();
    formData.append("zip_file", zipFile);
    return request<{ message: string; details?: unknown[] }>(
      "/admin/admin/bulk-import",
      { message: "Đã nhận gói nhập dữ liệu mẫu", details: [] },
      { method: "POST", body: formData },
    );
  },
  resyncVectors: () =>
    request<{ message: string }>(
      "/admin/admin/re-sync-all-vectors",
      { message: "Đang yêu cầu tính toán lại vector mẫu" },
      jsonRequest("POST"),
    ),
  clearLogs: (days: number) =>
    request<{ message: string }>(
      `/admin/admin/clear-logs?days=${days}`,
      { message: `Đã xóa bản ghi cũ hơn ${days} ngày trong dữ liệu mẫu` },
      jsonRequest("DELETE"),
    ),
};
