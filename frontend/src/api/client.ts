import type {
  AttendanceLog,
  BulkImportResponse,
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

async function request<T>(pathOrPaths: string | string[], init?: RequestInit): Promise<T> {
  const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
  const firstPath = paths[0];
  let lastHttpError = "";
  try {
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      const response = await fetch(`${API_BASE_URL}${path}`, withDefaultHeaders(init));
      if (!response.ok) {
        lastHttpError = await readErrorMessage(response);
        if ((response.status === 404 || response.status === 405) && index < paths.length - 1) {
          continue;
        }

        throw new Error(lastHttpError);
      }

      currentMode = "live";
      return (await response.json()) as T;
    }

    throw new Error(lastHttpError || `Không thể kết nối backend: ${paths[0]}`);
  } catch (error) {
    currentMode = "offline";
    throw error instanceof Error ? error : new Error(`Không thể kết nối backend: ${firstPath}`);
  }
}

async function requestBlob(pathOrPaths: string | string[], init?: RequestInit): Promise<Blob> {
  const paths = Array.isArray(pathOrPaths) ? pathOrPaths : [pathOrPaths];
  const firstPath = paths[0];
  let lastHttpError = "";
  try {
    for (let index = 0; index < paths.length; index += 1) {
      const path = paths[index];
      const response = await fetch(`${API_BASE_URL}${path}`, withDefaultHeaders(init));
      if (!response.ok) {
        lastHttpError = await readErrorMessage(response);
        if ((response.status === 404 || response.status === 405) && index < paths.length - 1) {
          continue;
        }

        throw new Error(lastHttpError);
      }

      currentMode = "live";
      return await response.blob();
    }

    throw new Error(lastHttpError || `Khong the ket noi backend: ${paths[0]}`);
  } catch (error) {
    currentMode = "offline";
    throw error instanceof Error ? error : new Error(`Khong the ket noi backend: ${firstPath}`);
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

  getSystemStats: () => request<SystemStats>(["/admin/system-stats", "/admin/admin/system-stats"]),

  getEmployees: () => request<Employee[]>(["/employees/", "/employees/employees/"]),
  searchEmployees: (query: string) =>
    request<Employee[]>([
      `/employees/search?query=${encodeURIComponent(query)}`,
      `/employees/employees/search?query=${encodeURIComponent(query)}`,
    ]),
  
  searchEmployeesAdvanced: (filters: {
    query?: string;
    department_id?: number;
    is_active?: boolean;
    ids?: number[];
    codes?: string[];
  }) => {
    const params = new URLSearchParams();
    if (filters.query) params.append("query", filters.query);
    if (filters.department_id !== undefined) params.append("department_id", String(filters.department_id));
    if (filters.is_active !== undefined) params.append("is_active", String(filters.is_active));
    if (filters.ids && filters.ids.length > 0) params.append("ids", filters.ids.join(","));
    if (filters.codes && filters.codes.length > 0) params.append("codes", filters.codes.join(","));
    
    const queryString = params.toString();
    const searchUrl = `/employees/search${queryString ? "?" + queryString : ""}`;
    
    return request<Employee[]>([
      searchUrl,
      `/employees/employees/search${queryString ? "?" + queryString : ""}`,
    ]);
  },

  registerEmployee: (formData: FormData) =>
    request<Employee>(["/employees/register", "/employees/employees/register"], {
      method: "POST",
      body: formData,
    }),
  updateEmployeeStatus: (id: number, isActive: boolean) =>
    request<Employee | null>(
      [
        `/employees/${id}/status?is_active=${isActive}`,
        `/employees/employees/${id}/status?is_active=${isActive}`,
      ],
      jsonRequest("PATCH"),
    ),
  deleteEmployee: (id: number) =>
    request<{ status: string; message: string }>(
      [`/employees/${id}`, `/employees/employees/${id}`],
      jsonRequest("DELETE"),
    ),
  setEmployeePermission: (
    employeeId: number,
    doorId: number,
    allowedStartTime?: string,
    allowedEndTime?: string,
  ) =>
    request<{ status: string }>(
      [`/employees/${employeeId}/permissions`, `/employees/employees/${employeeId}/permissions`],
      jsonRequest("PUT", {
        door_id: doorId,
        allowed_start_time: allowedStartTime || null,
        allowed_end_time: allowedEndTime || null,
      }),
    ),

  getDoors: () => request<Door[]>(["/doors/", "/doors/doors/"]),
  createDoor: (payload: Pick<Door, "name" | "description">) =>
    request<Door>(["/doors/", "/doors/doors/"], jsonRequest("POST", payload)),
  deleteDoor: (doorId: number) =>
    request<{ status: string; message: string }>(
      [`/doors/${doorId}`, `/doors/doors/${doorId}`],
      jsonRequest("DELETE"),
    ),

  getDepartments: () => request<Department[]>(["/departments/", "/departments/departments/"]),
  createDepartment: (name: string) =>
    request<Department>(["/departments/", "/departments/departments/"], jsonRequest("POST", { name })),
  deleteDepartment: (departmentId: number) =>
    request<{ status: string; message: string }>(
      [`/departments/${departmentId}`, `/departments/departments/${departmentId}`],
      jsonRequest("DELETE"),
    ),
  setDepartmentPermission: (
    departmentId: number,
    doorId: number,
    allowedStartTime?: string,
    allowedEndTime?: string,
  ) =>
    request<{ id: number }>(
      ["/departments/permissions", "/departments/departments/permissions"],
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
      [
        `/attendance/identify?door_name=${encodeURIComponent(doorName)}`,
      ],
      {
        method: "POST",
        body: formData,
      },
    );
  },
  getAttendanceHistory: (limit = 100, employeeIds?: number | number[]) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (employeeIds) {
      if (Array.isArray(employeeIds)) {
        params.set("employee_ids", employeeIds.join(","));
      } else {
        params.set("employee_id", String(employeeIds));
      }
    }
    return request<AttendanceLog[]>([
      `/attendance/history?${params.toString()}`,
    ]);
  },
  getDepartmentsWithPermissions: () =>
    request<Array<{ id: number; name: string; permissions: Array<any> }>>(
      [`/attendance/departments-with-permissions`],
    ),
  getAttendanceSnapshot: (snapshotPath: string) => {
    const params = new URLSearchParams({ path: snapshotPath });
    return requestBlob([
      `/attendance/snapshot?${params.toString()}`,
    ]);
  },
  getMonthlyStats: (month: number, year: number) =>
    request<MonthlyStats>([
      `/attendance/stats/monthly?month=${month}&year=${year}`,
      `/attendance/attendance/stats/monthly?month=${month}&year=${year}`,
    ]),
  getExcelExportUrl: (month: number, year: number) =>
    `${API_BASE_URL}/attendance/export/excel?month=${month}&year=${year}`,

  bulkImport: (zipFile: File) => {
    const formData = new FormData();
    formData.append("zip_file", zipFile);
    return request<BulkImportResponse>(
      ["/admin/bulk-import", "/admin/admin/bulk-import"],
      { method: "POST", body: formData },
    );
  },
  resyncVectors: () =>
    request<{ message: string }>(
      ["/admin/re-sync-all-vectors", "/admin/admin/re-sync-all-vectors"],
      jsonRequest("POST"),
    ),
  clearLogs: (days: number) =>
    request<{ message: string }>(
      [`/admin/clear-logs?days=${days}`, `/admin/admin/clear-logs?days=${days}`],
      jsonRequest("DELETE"),
    ),

  getEmployeePhotos: (employeeId: number) =>
    request<{ employee_id: number; employee_name: string; photos: string[] }>(
      [
        `/employees/${employeeId}/photos`,
        `/employees/employees/${employeeId}/photos`,
      ],
    ),
  getEmployeePhoto: (employeeId: number, photoName: string) =>
    requestBlob(
      [
        `/employees/${employeeId}/photo/${encodeURIComponent(photoName)}`,
        `/employees/employees/${employeeId}/photo/${encodeURIComponent(photoName)}`,
      ],
    ),
  updateEmployeePhotos: (employeeId: number, files: File[]) => {
    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));
    return request<{ status: string; message: string; photos: string[] }>(
      [
        `/employees/${employeeId}/photos`,
        `/employees/employees/${employeeId}/photos`,
      ],
      {
        method: "PUT",
        body: formData,
      },
    );
  },
};
