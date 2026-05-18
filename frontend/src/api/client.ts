import type {
  AttendanceLog,
  Department,
  Door,
  Employee,
  IdentifyResult,
  MonthlyStats,
  SystemStats,
} from "../types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "https://graffiti-fit-error.ngrok-free.dev/api/v1";
const NGROK_SKIP_WARNING_HEADER = "ngrok-skip-browser-warning";

export type ApiMode = "live" | "offline";

let currentMode: ApiMode = "live";

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export function getApiMode() {
  return currentMode;
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string; message?: string };
    return payload.detail || payload.message || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

function withDefaultHeaders(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (API_BASE_URL.includes("ngrok-free.dev")) {
    headers.set(NGROK_SKIP_WARNING_HEADER, "true");
  }

  return { ...init, headers };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, withDefaultHeaders(init));
    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }
    currentMode = "live";
    return (await response.json()) as T;
  } catch (error) {
    currentMode = "offline";
    throw error instanceof Error ? error : new Error(`Không thể kết nối backend: ${path}`);
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
    const rootUrl = API_BASE_URL.replace(/\/api\/v1\/?$/, "");
    try {
      const response = await fetch(`${rootUrl}/health`, withDefaultHeaders());
      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }
      currentMode = "live";
      return (await response.json()) as { status: string };
    } catch (error) {
      currentMode = "offline";
      throw error instanceof Error ? error : new Error("Không thể kiểm tra trạng thái backend.");
    }
  },

  getSystemStats: () => request<SystemStats>("/admin/admin/system-stats"),

  getEmployees: () => request<Employee[]>("/employees/employees/"),
  searchEmployees: (query: string) =>
    request<Employee[]>(`/employees/employees/search?query=${encodeURIComponent(query)}`),
  registerEmployee: (formData: FormData) =>
    request<Employee>("/employees/employees/register", {
      method: "POST",
      body: formData,
    }),
  updateEmployeeStatus: (id: number, isActive: boolean) =>
    request<Employee | null>(
      `/employees/employees/${id}/status?is_active=${isActive}`,
      jsonRequest("PATCH"),
    ),
  deleteEmployee: (id: number) =>
    request<{ status: string; message: string }>(
      `/employees/employees/${id}`,
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
      jsonRequest("PUT", {
        door_id: doorId,
        allowed_start_time: allowedStartTime || null,
        allowed_end_time: allowedEndTime || null,
      }),
    ),

  getDoors: () => request<Door[]>('/doors/doors/'),
  createDoor: (payload: Pick<Door, "name" | "description">) =>
    request<Door>("/doors/doors/", jsonRequest("POST", payload)),
  deleteDoor: (doorId: number) =>
    request<{ status: string; message: string }>(
      `/doors/doors/${doorId}`,
      jsonRequest("DELETE"),
    ),

  getDepartments: () => request<Department[]>('/departments/departments/'),
  createDepartment: (name: string) =>
    request<Department>("/departments/departments/", jsonRequest("POST", { name })),
  deleteDepartment: (departmentId: number) =>
    request<{ status: string; message: string }>(
      `/departments/departments/${departmentId}`,
      jsonRequest("DELETE"),
    ),
  setDepartmentPermission: (
    departmentId: number,
    doorId: number,
    allowedStartTime?: string,
    allowedEndTime?: string,
  ) =>
    request<{ id: number }>(
      "/departments/departments/permissions",
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
      {
        method: "POST",
        body: formData,
      },
    );
  },
  getAttendanceHistory: (limit = 100, employeeId?: number) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (employeeId) params.set("employee_id", String(employeeId));
    return request<AttendanceLog[]>(`/attendance/attendance/history?${params.toString()}`);
  },
  getMonthlyStats: (month: number, year: number) =>
    request<MonthlyStats>(`/attendance/attendance/stats/monthly?month=${month}&year=${year}`),
  getExcelExportUrl: (month: number, year: number) =>
    `${API_BASE_URL}/attendance/attendance/export/excel?month=${month}&year=${year}`,

  bulkImport: (zipFile: File) => {
    const formData = new FormData();
    formData.append("zip_file", zipFile);
    return request<{ message: string; details?: unknown[] }>(
      "/admin/admin/bulk-import",
      { method: "POST", body: formData },
    );
  },
  resyncVectors: () =>
    request<{ message: string }>(
      "/admin/admin/re-sync-all-vectors",
      jsonRequest("POST"),
    ),
  clearLogs: (days: number) =>
    request<{ message: string }>(
      `/admin/admin/clear-logs?days=${days}`,
      jsonRequest("DELETE"),
    ),
};
