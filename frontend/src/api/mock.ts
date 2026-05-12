import type {
  AttendanceLog,
  Department,
  Door,
  Employee,
  IdentifyResult,
  MonthlyStats,
  SystemStats,
} from "../types";

export const mockStats: SystemStats = {
  employees: 32,
  departments: 5,
  doors: 8,
  today_logs: 47,
};

export const mockDoors: Door[] = [
  { id: 1, name: "Cửa chính", description: "Cổng vào sảnh tầng 1" },
  { id: 2, name: "Phòng Server", description: "Khu vực giới hạn" },
  { id: 3, name: "Phòng Kỹ thuật", description: "Lối vào khối kỹ thuật" },
];

export const mockDepartments: Department[] = [
  { id: 1, name: "Nhân Sự" },
  { id: 2, name: "Kỹ Thuật" },
  { id: 3, name: "Bảo Vệ" },
];

export const mockEmployees: Employee[] = [
  {
    id: 1,
    full_name: "Nguyễn Văn An",
    employee_code: "NV001",
    role: "user",
    is_active: true,
    department_id: 2,
  },
  {
    id: 2,
    full_name: "Trần Thị Bình",
    employee_code: "NV002",
    role: "user",
    is_active: true,
    department_id: 1,
  },
  {
    id: 3,
    full_name: "Lê Minh Châu",
    employee_code: "NV003",
    role: "user",
    is_active: false,
    department_id: 3,
  },
];

export const mockHistory: AttendanceLog[] = [
  {
    id: 1001,
    employee_id: 1,
    door_id: 1,
    checkin_at: new Date().toISOString(),
    status: "SUCCESS",
    reason: "Hợp lệ",
    image_snapshot: "snapshots/demo/an.jpg",
  },
  {
    id: 1002,
    employee_id: null,
    door_id: 2,
    checkin_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    status: "DENIED",
    reason: "Người lạ",
  },
  {
    id: 1003,
    employee_id: 3,
    door_id: 3,
    checkin_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    status: "DENIED",
    reason: "Tài khoản bị khóa",
  },
];

export const mockIdentifySuccess: IdentifyResult = {
  match: true,
  employee_name: "Nguyễn Văn An",
  employee_code: "NV001",
  open_door: true,
  message: "Hợp lệ",
};

export const mockMonthlyStats: MonthlyStats = {
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  total_records: 3,
  data: [
    {
      employee_id: 1,
      full_name: "Nguyễn Văn An",
      employee_code: "NV001",
      date: new Date().toISOString().slice(0, 10),
      first_in: "08:02",
      last_out: "17:36",
    },
  ],
};
