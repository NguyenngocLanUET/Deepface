import {
  BarChart3,
  Building2,
  Camera,
  CheckCircle2,
  Database,
  DoorOpen,
  Download,
  FileArchive,
  Gauge,
  History,
  Image,
  KeyRound,
  Lock,
  LogOut,
  Printer,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  UserPlus,
  UserRound,
  Users,
  XCircle,
} from "lucide-react";
import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import { useCameraGate } from "./hooks/useCameraGate";
import { useTinyFaceRegister } from "./hooks/useTinyFaceRegister";
import type {
  AttendanceLog,
  BulkImportSummary,
  Department,
  Door,
  Employee,
  IdentifyResult,
  MonthlyStats,
  SystemStats,
} from "./types";

type PageId =
  | "dashboard"
  | "kiosk"
  | "employees"
  | "register"
  | "doors"
  | "departments"
  | "permissions"
  | "history"
  | "reports"
  | "admin";

type Notice = {
  type: "success" | "error" | "info";
  text: string;
};

type ImportLogSummary = {
  success: number;
  errors: number;
  noImages: number;
};

type ImportLogEntry = {
  id: string;
  fileName: string;
  message: string;
  importedAt: string;
  totalAdded: number;
  summary: ImportLogSummary;
};

type UserRole = "admin" | "user";

type AppSession = {
  username: string;
  displayName: string;
  role: UserRole;
  employeeId?: number;
  signedInAt: string;
};

const SESSION_STORAGE_KEY = "faceaccess-session";
const AUTO_CAPTURE_COOLDOWN_MS = 2000;
const NOTICE_AUTO_HIDE_MS = 5000;

const initialStats: SystemStats = {
  employees: 0,
  departments: 0,
  doors: 0,
  today_logs: 0,
};

const navItems: Array<{
  id: PageId;
  label: string;
  icon: typeof Gauge;
}> = [
  { id: "dashboard", label: "Tổng quan", icon: Gauge },
  { id: "kiosk", label: "Camera ra vào", icon: Camera },
  { id: "employees", label: "Nhân viên", icon: Users },
  { id: "register", label: "Đăng ký khuôn mặt", icon: UserPlus },
  { id: "doors", label: "Cửa/Khu vực", icon: DoorOpen },
  { id: "departments", label: "Phòng ban", icon: Building2 },
  { id: "permissions", label: "Phân quyền", icon: ShieldCheck },
  { id: "history", label: "Lịch sử", icon: History },
  { id: "reports", label: "Báo cáo", icon: BarChart3 },
  { id: "admin", label: "Công cụ quản trị", icon: SlidersHorizontal },
];

const rolePages: Record<UserRole, PageId[]> = {
  admin: navItems.map((item) => item.id),
  user: ["history"],
};

const defaultPageByRole: Record<UserRole, PageId> = {
  admin: "dashboard",
  user: "history",
};

const loginAccounts: Array<AppSession & { password: string }> = [
  {
    username: "admin",
    password: "admin123",
    displayName: "Quản trị viên",
    role: "admin",
    signedInAt: "",
  },
  {
    username: "user",
    password: "user123",
    displayName: "Nguyễn Văn An",
    role: "user",
    employeeId: 1,
    signedInAt: "",
  },
];

const EMPLOYEE_DEFAULT_PASSWORDS = new Set(["user123", "user 123"]);

function formatDateTime(value: string) {
  // Nếu chuỗi thời gian không có ký tự múi giờ 'Z' hoặc dấu '+' (giờ UTC thô), 
  // chúng ta chủ động thêm 'Z' để JS hiểu đây là giờ UTC và tự động +7 tiếng sang giờ Việt Nam.
  const utcValue = value.endsWith("Z") || value.includes("+") ? value : `${value}Z`;
  
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Asia/Ho_Chi_Minh", // Ép buộc hiển thị theo giờ Việt Nam
  }).format(new Date(utcValue));
}

function toDateInputValue(value: string) {
  const utcValue = value.endsWith("Z") || value.includes("+") ? value : `${value}Z`;
  const date = new Date(utcValue);
  
  // Trả về định dạng YYYY-MM-DD theo đúng ngày thực tế tại Việt Nam 
  // (tránh việc lệch múi giờ làm ngày bị lùi hoặc tiến 1 ngày)
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function countDistinctDays(items: AttendanceLog[]) {
  return new Set(items.filter((item) => item.status === "SUCCESS").map((item) => toDateInputValue(item.checkin_at)))
    .size;
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeLoginCode(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

// Kiểm tra chất lượng ảnh để detect blur, độ sáng, kích thước khuôn mặt
async function analyzeImageQuality(file: File): Promise<{ isGood: boolean; issues: string[] }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    
    reader.onerror = () => {
      console.error("FileReader error:", reader.error);
      resolve({ isGood: false, issues: ["Lỗi đọc file"] });
    };

    reader.onload = (event) => {
      const img = new Image();
      img.onerror = () => {
        console.error("Image load error");
        resolve({ isGood: false, issues: ["Không thể tải ảnh"] });
      };
      
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve({ isGood: false, issues: ["Không thể xử lý ảnh"] });
            return;
          }

          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const data = imageData.data;
          const issues: string[] = [];

          // Kiểm tra độ sáng trung bình
          let brightness = 0;
          for (let i = 0; i < data.length; i += 4) {
            brightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
          }
          brightness /= data.length / 4;

          console.log("Brightness:", Math.round(brightness));

          if (brightness < 30) {
            issues.push("Ảnh quá tối");
          } else if (brightness > 230) {
            issues.push("Ảnh quá sáng");
          }

          // Kiểm tra Laplacian để phát hiện blur (độ sắc nét)
          const grayscale: number[] = [];
          for (let i = 0; i < data.length; i += 4) {
            grayscale.push(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
          }

          let laplacian = 0;
          const w = canvas.width;
          const h = canvas.height;
          let validPixels = 0;

          for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
              const i = y * w + x;
              const val =
                -grayscale[i] * 8 +
                grayscale[i - 1] +
                grayscale[i + 1] +
                grayscale[i - w] +
                grayscale[i + w] +
                grayscale[i - w - 1] +
                grayscale[i - w + 1] +
                grayscale[i + w - 1] +
                grayscale[i + w + 1];
              laplacian += val * val;
              validPixels++;
            }
          }
          laplacian = validPixels > 0 ? Math.sqrt(laplacian / validPixels) : 0;

          console.log("Laplacian (sharpness):", Math.round(laplacian));

          if (laplacian < 25) {
            issues.push("Ảnh quá mờ/nhòe");
          }

          const isGood = issues.length === 0;
          console.log("Image quality check:", { isGood, issues, brightness: Math.round(brightness), laplacian: Math.round(laplacian) });
          resolve({ isGood, issues });
        } catch (error) {
          console.error("Analysis error:", error);
          resolve({ isGood: false, issues: ["Lỗi kiểm tra chất lượng"] });
        }
      };

      const dataUrl = event.target?.result as string;
      img.src = dataUrl;
    };

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Read error:", error);
      resolve({ isGood: false, issues: ["Lỗi đọc ảnh"] });
    }
  });
}

// Tiền xử lý ảnh: adjust brightness, contrast, sharpen
async function preprocessImage(file: File): Promise<File> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file); // Lỗi, trả về file gốc
          return;
        }

        ctx.drawImage(img, 0, 0);
        let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        // 1. Tính brightness hiện tại
        let brightness = 0;
        for (let i = 0; i < data.length; i += 4) {
          brightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
        }
        brightness /= data.length / 4;

        // 2. Adjust brightness & contrast
        const targetBrightness = 128;
        const brightnessDiff = targetBrightness - brightness;
        const contrastFactor = 1.1; // Tăng contrast 10%

        for (let i = 0; i < data.length; i += 4) {
          let r = data[i];
          let g = data[i + 1];
          let b = data[i + 2];

          // Adjust brightness
          r = Math.min(255, Math.max(0, r + brightnessDiff * 0.3));
          g = Math.min(255, Math.max(0, g + brightnessDiff * 0.3));
          b = Math.min(255, Math.max(0, b + brightnessDiff * 0.3));

          // Adjust contrast
          r = Math.min(255, Math.max(0, 128 + (r - 128) * contrastFactor));
          g = Math.min(255, Math.max(0, 128 + (g - 128) * contrastFactor));
          b = Math.min(255, Math.max(0, 128 + (b - 128) * contrastFactor));

          data[i] = Math.round(r);
          data[i + 1] = Math.round(g);
          data[i + 2] = Math.round(b);
        }

        ctx.putImageData(imageData, 0, 0);

        // 3. Unsharp mask (sharpen) - đơn giản
        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext("2d");
        if (tempCtx) {
          tempCtx.drawImage(canvas, 0, 0);
          const blurredData = tempCtx.getImageData(0, 0, canvas.width, canvas.height);
          const blurredPixels = blurredData.data;

          // Tạo version mờ
          for (let i = 0; i < blurredPixels.length; i += 4) {
            blurredPixels[i] = Math.round(blurredPixels[i] * 0.8);
            blurredPixels[i + 1] = Math.round(blurredPixels[i + 1] * 0.8);
            blurredPixels[i + 2] = Math.round(blurredPixels[i + 2] * 0.8);
          }

          // Sharpening: Original + (Original - Blurred) * 0.5
          imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i] = Math.min(255, Math.max(0, imageData.data[i] + (imageData.data[i] - blurredPixels[i]) * 0.3));
            imageData.data[i + 1] = Math.min(255, Math.max(0, imageData.data[i + 1] + (imageData.data[i + 1] - blurredPixels[i + 1]) * 0.3));
            imageData.data[i + 2] = Math.min(255, Math.max(0, imageData.data[i + 2] + (imageData.data[i + 2] - blurredPixels[i + 2]) * 0.3));
          }
          ctx.putImageData(imageData, 0, 0);
        }

        // 4. Convert canvas về File
        canvas.toBlob(
          (blob) => {
            if (blob) {
              const processedFile = new File([blob], `processed-${Date.now()}.jpg`, { type: "image/jpeg" });
              console.log("Image preprocessed:", processedFile.name);
              resolve(processedFile);
            } else {
              resolve(file);
            }
          },
          "image/jpeg",
          0.92
        );
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

function readStoredSession() {
  try {
    const rawSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!rawSession) return null;
    const session = JSON.parse(rawSession) as AppSession;
    if (!session?.username || !session?.role) return null;
    if (session.role === "user" && !session.employeeId) {
      return {
        ...session,
        displayName: session.displayName === "Nhân viên" ? "Nguyễn Văn An" : session.displayName,
        employeeId: 1,
      };
    }
    return session;
  } catch {
    return null;
  }
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  const className =
    normalized === "SUCCESS"
      ? "badge success"
      : normalized === "DENIED"
        ? "badge danger"
        : "badge muted";
  const label =
    normalized === "SUCCESS" ? "Thành công" : normalized === "DENIED" ? "Từ chối" : status;

  return <span className={className}>{label}</span>;
}

function cameraStatusLabel(value: string) {
  const labels: Record<string, string> = {
    idle: "Chưa bật",
    loading: "Đang tải",
    ready: "Sẵn sàng",
    detecting: "Đang dò khuôn mặt",
    error: "Có lỗi",
  };
  return labels[value] ?? value;
}

function detectorLabel(value: string) {
  const labels: Record<string, string> = {
    mediapipe: "MediaPipe",
    browser: "Trình duyệt",
    "frame-signal": "Tín hiệu khung hình",
    none: "Chưa có",
  };
  return labels[value] ?? value;
}

function NoticeBar({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div className={`notice ${notice.type}`}>{notice.text}</div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

type AmPmTime = {
  hour12: string;
  minute: string;
  meridiem: "AM" | "PM";
};

function formatReportValue(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Có" : "Không";
  }

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  // Check if value is ISO datetime string (first_in, last_out, checkin_at)
  const stringValue = String(value);
  if (stringValue.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
    return formatDateTime(stringValue);
  }

  return stringValue;
}

function parse24HourTime(value: string): AmPmTime {
  const [rawHour = "08", rawMinute = "00"] = value.split(":");
  const hour24 = Number(rawHour);
  const meridiem: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;

  return {
    hour12: String(hour12).padStart(2, "0"),
    minute: rawMinute.padStart(2, "0"),
    meridiem,
  };
}

function to24HourTime({ hour12, minute, meridiem }: AmPmTime) {
  let hour = Number(hour12) % 12;
  if (meridiem === "PM") {
    hour += 12;
  }
  return `${String(hour).padStart(2, "0")}:${minute}`;
}

function sanitizeTimePart(value: string, maxLength: number) {
  return value.replace(/\D/g, "").slice(0, maxLength);
}

function clampTimePart(value: string, min: number, max: number, fallback: string) {
  if (!value) {
    return fallback;
  }

  const numericValue = Number(value);
  if (Number.isNaN(numericValue)) {
    return fallback;
  }

  return String(Math.min(max, Math.max(min, numericValue))).padStart(2, "0");
}

function TimeMeridiemField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: AmPmTime;
  onChange: (value: AmPmTime) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="time-meridiem-picker">
        <input
          aria-label={`${label} giờ`}
          inputMode="numeric"
          maxLength={2}
          value={value.hour12}
          onBlur={() => onChange({ ...value, hour12: clampTimePart(value.hour12, 1, 12, "08") })}
          onChange={(event) => onChange({ ...value, hour12: sanitizeTimePart(event.target.value, 2) })}
          placeholder="08"
          type="text"
        />
        <span>:</span>
        <input
          aria-label={`${label} phút`}
          inputMode="numeric"
          maxLength={2}
          value={value.minute}
          onBlur={() => onChange({ ...value, minute: clampTimePart(value.minute, 0, 59, "00") })}
          onChange={(event) => onChange({ ...value, minute: sanitizeTimePart(event.target.value, 2) })}
          placeholder="00"
          type="text"
        />
        <select
          aria-label={`${label} AM PM`}
          value={value.meridiem}
          onChange={(event) => onChange({ ...value, meridiem: event.target.value as "AM" | "PM" })}
        >
          <option value="AM">AM</option>
          <option value="PM">PM</option>
        </select>
      </div>
    </label>
  );
}

function LoginPage({ onLogin }: { onLogin: (session: AppSession) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loginEmployees, setLoginEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    let cancelled = false;

    api.getEmployees()
      .then((result) => {
        if (!cancelled) setLoginEmployees(result.filter((employee) => employee.is_active));
      })
      .catch(() => {
        if (!cancelled) setLoginEmployees([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const normalizedUsername = username.trim();
    const normalizedPassword = password.trim();
    const account = loginAccounts.find(
      (item) => item.username === normalizedUsername && item.password === normalizedPassword,
    );

    const employeeAccount = loginEmployees.find(
      (employee) => normalizeLoginCode(employee.employee_code) === normalizeLoginCode(normalizedUsername),
    );

    if (!account && (!employeeAccount || !EMPLOYEE_DEFAULT_PASSWORDS.has(normalizedPassword.toLowerCase()))) {
      setError("Sai tài khoản hoặc mật khẩu.");
      return;
    }

    if (employeeAccount) {
      const session: AppSession = {
        username: employeeAccount.employee_code,
        displayName: employeeAccount.full_name,
        role: "user",
        employeeId: employeeAccount.id,
        signedInAt: new Date().toISOString(),
      };

      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      setError("");
      onLogin(session);
      return;
    }

    if (!account) return;

    const session: AppSession = {
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      employeeId: account.employeeId,
      signedInAt: new Date().toISOString(),
    };

    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    setError("");
    onLogin(session);
  };

  const fillAccount = (role: UserRole) => {
    const account = loginAccounts.find((item) => item.role === role);
    if (!account) return;
    setUsername(account.username);
    setPassword(account.password);
    setError("");
  };

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div className="login-brand">
          <div className="brand-mark">
            <ShieldCheck size={28} />
          </div>
          <div>
            <strong>FaceAccess AI</strong>
            <span>Đăng nhập hệ thống</span>
          </div>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label className="field">
            <span>Tài khoản</span>
            <div className="input-with-icon">
              <UserRound size={18} />
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
              />
            </div>
          </label>

          <label className="field">
            <span>Mật khẩu</span>
            <div className="input-with-icon">
              <KeyRound size={18} />
              <input
                autoComplete="current-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </div>
          </label>

          {error && <div className="inline-error">{error}</div>}

          <button className="primary-button" type="submit">
            <ShieldCheck size={18} />
            Đăng nhập
          </button>
        </form>

        <div className="login-shortcuts" aria-label="Tài khoản thử nghiệm">
          <button type="button" onClick={() => fillAccount("admin")}>
            Admin
          </button>
          <button type="button" onClick={() => fillAccount("user")}>
            User
          </button>
        </div>

      </section>
    </main>
  );
}

function App() {
  const [activePage, setActivePage] = useState<PageId>("dashboard");
  const [session, setSession] = useState<AppSession | null>(() => readStoredSession());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [stats, setStats] = useState<SystemStats>(initialStats);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [doors, setDoors] = useState<Door[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [history, setHistory] = useState<AttendanceLog[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<MonthlyStats | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshCoreData = useCallback(async (showLoading = false) => {
    if (!session) return;
    if (showLoading) setLoading(true);

    try {
      if (session.role === "user") {
        const [doorResult, historyResult] = await Promise.all([
          api.getDoors(),
          api.getAttendanceHistory(1000, session.employeeId),
        ]);

        setStats(initialStats);
        setEmployees([]);
        setDoors(doorResult);
        setDepartments([]);
        setHistory(historyResult);
        return;
      }

      const [statsResult, employeeResult, doorResult, departmentResult, historyResult] =
        await Promise.all([
          api.getSystemStats(),
          api.getEmployees(),
          api.getDoors(),
          api.getDepartments(),
          api.getAttendanceHistory(1000),
        ]);

      setStats(statsResult);
      setEmployees(employeeResult);
      setDoors(doorResult);
      setDepartments(departmentResult);
      setHistory(historyResult);
    } catch (error) {
      setNotice({ type: "error", text: errorMessage(error, "Không thể tải dữ liệu từ backend.") });
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      void refreshCoreData(true);
    }
  }, [refreshCoreData, session]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visibleNavItems = useMemo(() => {
    if (!session) return [];
    const allowedPages = new Set(rolePages[session.role]);
    return navItems
      .filter((item) => allowedPages.has(item.id))
      .map((item) =>
        session.role === "user" && item.id === "history"
          ? { ...item, label: "Chấm công của tôi" }
          : item,
      );
  }, [session]);

  useEffect(() => {
    if (!session) return;
    if (!rolePages[session.role].includes(activePage)) {
      setActivePage(defaultPageByRole[session.role]);
    }
  }, [activePage, session]);

  const pageTitle = useMemo(
    () => visibleNavItems.find((item) => item.id === activePage)?.label ?? "FaceAccess AI",
    [activePage, visibleNavItems],
  );

  const handleLogin = (nextSession: AppSession) => {
    setSession(nextSession);
    setActivePage(defaultPageByRole[nextSession.role]);
    setNotice(
      nextSession.role === "admin"
        ? { type: "success", text: `Đã đăng nhập bằng tài khoản ${nextSession.displayName}.` }
        : null,
    );
  };

  const handleLogout = () => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setSession(null);
    setNotice(null);
    setActivePage("dashboard");
  };

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <ShieldCheck size={24} />
          </div>
          <div>
            <strong>FaceAccess AI</strong>
            <span>Bảng điều khiển</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Điều hướng chính">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={activePage === item.id ? "nav-item active" : "nav-item"}
                onClick={() => setActivePage(item.id)}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <h1>{pageTitle}</h1>
          </div>
          <div className="topbar-actions">
            <span className="pill user-pill">
              <UserRound size={16} />
              {session.displayName}
            </span>
            <button className="icon-button" onClick={() => void refreshCoreData()} type="button">
              <RefreshCw size={18} />
            </button>
            <button className="icon-button" onClick={handleLogout} type="button" title="Đăng xuất">
              <LogOut size={18} />
            </button>
          </div>
        </header>

        <NoticeBar notice={notice} />

        {loading ? (
          <div className="loading-panel">Đang tải dữ liệu hệ thống...</div>
        ) : (
          <>
            {activePage === "dashboard" && (
              <DashboardPage stats={stats} history={history} employees={employees} />
            )}
            {activePage === "kiosk" && (
              <KioskPage
                doors={doors}
                onNotice={setNotice}
                onRefresh={() => void refreshCoreData()}
              />
            )}
            {activePage === "employees" && (
              <EmployeesPage
                employees={employees}
                departments={departments}
                onNotice={setNotice}
                onRefresh={() => void refreshCoreData()}
              />
            )}
            {activePage === "register" && (
              <RegisterPage
                departments={departments}
                onNotice={setNotice}
                onRefresh={() => void refreshCoreData()}
              />
            )}
            {activePage === "doors" && (
              <DoorsPage doors={doors} onNotice={setNotice} onRefresh={() => void refreshCoreData()} />
            )}
            {activePage === "departments" && (
              <DepartmentsPage
                departments={departments}
                onNotice={setNotice}
                onRefresh={() => void refreshCoreData()}
              />
            )}
            {activePage === "permissions" && (
              <PermissionsPage
                employees={employees}
                departments={departments}
                doors={doors}
                onNotice={setNotice}
              />
            )}
            {activePage === "history" && (
              <HistoryPage history={history} employees={employees} doors={doors} session={session} />
            )}
            {activePage === "reports" && (
              <ReportsPage
                monthlyStats={monthlyStats}
                setMonthlyStats={setMonthlyStats}
                onNotice={setNotice}
              />
            )}
            {activePage === "admin" && <AdminToolsPage onNotice={setNotice} />}
          </>
        )}
      </main>
    </div>
  );
}

function DashboardPage({
  stats,
  history,
  employees,
}: {
  stats: SystemStats;
  history: AttendanceLog[];
  employees: Employee[];
}) {
  const successCount = history.filter((item) => item.status === "SUCCESS").length;
  const deniedCount = history.filter((item) => item.status === "DENIED").length;
  const activeEmployees = employees.filter((item) => item.is_active).length;

  return (
    <div className="page-grid">
      <section className="metrics-grid">
        <Metric icon={Users} label="Nhân viên" value={stats.employees} sub={`${activeEmployees} đang hoạt động`} />
        <Metric icon={Building2} label="Phòng ban" value={stats.departments} sub="Quyền có thể kế thừa" />
        <Metric icon={DoorOpen} label="Cửa/Khu vực" value={stats.doors} sub="Điểm kiểm soát" />
        <Metric icon={History} label="Lượt hôm nay" value={stats.today_logs} sub="Ghi nhận vào log" />
      </section>

      <section className="panel wide">
        <div className="section-heading">
          <div>
            <h2>Tình trạng nhận diện</h2>
            <p>Tỷ lệ thành công và từ chối trong tập log gần nhất.</p>
          </div>
          <Database size={22} />
        </div>
        <div className="split-chart">
          <div className="donut" style={{ "--success": `${Math.max(successCount, 1)}` } as React.CSSProperties}>
            <span>{successCount + deniedCount}</span>
            <small>bản ghi</small>
          </div>
          <div className="chart-legend">
            <span>
              <i className="dot green" /> Thành công: {successCount}
            </span>
            <span>
              <i className="dot red" /> Từ chối: {deniedCount}
            </span>
            <span>
              <i className="dot blue" /> Cooldown và snapshot do backend xử lý
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Lịch sử ra vào gần đây</h2>
          </div>
        </div>
        <div className="activity-list">
          {history.slice(0, 5).map((item) => (
            <div className="activity-row" key={item.id}>
              <StatusBadge status={item.status} />
              <div>
                <strong>Nhân viên #{item.employee_id ?? "không rõ"}</strong>
                <span>{item.reason ?? "Không có lý do"}</span>
              </div>
              <time>{formatDateTime(item.checkin_at)}</time>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Gauge;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-icon">
        <Icon size={22} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
    </article>
  );
}

function KioskPage({
  doors,
  onNotice,
  onRefresh,
}: {
  doors: Door[];
  onNotice: (notice: Notice) => void;
  onRefresh: () => void;
}) {
  const camera = useCameraGate();
  const [selectedDoor, setSelectedDoor] = useState(doors[0]?.name ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [faceDetectedAt, setFaceDetectedAt] = useState<number | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(0);
  const clearResultTimerRef = useRef<number | null>(null);
  const lastSubmitTimeRef = useRef<number>(0);
  const countdownTimerRef = useRef<number | null>(null);
  const DETECTION_THROTTLE_MS = 500; // Ngăn submit quá nhanh
  const CAPTURE_COUNT = 10; // Số lượng ảnh để chụp
  const CAPTURE_INTERVAL_MS = 500; // Khoảng cách giữa các chụp (tổng ~5 giây)
  const STABLE_FACE_DURATION_MS = 5000; // Yêu cầu đứng yên 5 giây

  useEffect(() => {
    if (!selectedDoor && doors[0]) setSelectedDoor(doors[0].name);
  }, [doors, selectedDoor]);

  useEffect(() => {
    void camera.start().catch((error) => {
      onNotice({ type: "error", text: errorMessage(error, "Không thể bật camera ra vào.") });
    });

    return () => {
      camera.stop();
    };
  }, [camera.start, camera.stop, onNotice]);

  // Theo dõi countdown khi khuôn mặt được phát hiện
  useEffect(() => {
    if (camera.faceBox && !faceDetectedAt) {
      setFaceDetectedAt(Date.now());
      setCountdownSeconds(5); // 5 giây để chụp 10 ảnh
    }

    if (faceDetectedAt && camera.faceBox) {
      const elapsed = Math.floor((Date.now() - faceDetectedAt) / 1000);
      const remaining = Math.max(0, 5 - elapsed);
      setCountdownSeconds(remaining);
    } else if (!camera.faceBox) {
      setFaceDetectedAt(null);
      setCountdownSeconds(0);
    }
  }, [camera.faceBox, faceDetectedAt]);

  useEffect(
    () => () => {
      if (clearResultTimerRef.current) {
        window.clearTimeout(clearResultTimerRef.current);
      }
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
      }
    },
    [],
  );

  const submitFrame = useCallback(async () => {
    if (submitting) return;

    if (!selectedDoor) {
      onNotice({ type: "error", text: "Hãy tạo/chọn cửa trước khi nhận diện." });
      return;
    }

    if (!camera.canSubmit) return;

    // Ngăn submit quá nhanh
    const now = Date.now();
    if (now - lastSubmitTimeRef.current < DETECTION_THROTTLE_MS) return;
    lastSubmitTimeRef.current = now;

    setSubmitting(true);

    try {
      // Chụp 10 ảnh trong khoảng thời gian ~5 giây
      const capturedImages: Blob[] = [];
      
      for (let i = 0; i < CAPTURE_COUNT; i += 1) {
        try {
          const blob = await camera.captureBlob();
          if (blob) {
            capturedImages.push(blob);
            console.log(`📸 Đã chụp ảnh ${i + 1}/${CAPTURE_COUNT}`);
          }
        } catch (error) {
          console.error(`Lỗi chụp ảnh ${i + 1}:`, error);
        }

        // Tạm dừng giữa các chụp (ngoại trừ lần cuối cùng)
        if (i < CAPTURE_COUNT - 1) {
          await new Promise((resolve) => window.setTimeout(resolve, CAPTURE_INTERVAL_MS));
        }
      }

      if (capturedImages.length === 0) {
        onNotice({ type: "error", text: "Không thể chụp ảnh từ camera." });
        return;
      }

      console.log(`🔄 Gửi ${capturedImages.length} ảnh để xác định...`);
      
      // Gửi tất cả ảnh đến endpoint multi-image
      const identifyResult = await api.identifyMulti(selectedDoor, capturedImages);

      if (identifyResult) {
        setResult(identifyResult);
      }
      
      onRefresh(); // Làm mới bảng lịch sử ở dưới
      camera.resetDetection();

      // Xóa kết quả trên màn hình sau một khoảng thời gian
      if (clearResultTimerRef.current) {
        window.clearTimeout(clearResultTimerRef.current);
      }
      clearResultTimerRef.current = window.setTimeout(() => setResult(null), AUTO_CAPTURE_COOLDOWN_MS);
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Lỗi kết nối server.") });
    } finally {
      setSubmitting(false);
    }
  }, [camera, selectedDoor, submitting, onNotice, onRefresh]);
  // const pickMajorityResult = useCallback((results: IdentifyResult[]) => {
  //   if (results.length === 0) return null;

  //   const countMap = new Map<string, { count: number; result: IdentifyResult }>();

  //   for (const value of results) {
  //     const key = value.employee_code ?? (value.match ? "KNOWN" : "UNKNOWN");
  //     const current = countMap.get(key);
  //     if (!current) {
  //       countMap.set(key, { count: 1, result: value });
  //     } else {
  //       current.count += 1;
  //       if ((value.score ?? 0) > (current.result.score ?? 0)) {
  //         current.result = value;
  //       }
  //     }
  //   }

  //   let best: { count: number; result: IdentifyResult } | null = null;
  //   for (const entry of countMap.values()) {
  //     if (!best || entry.count > best.count) {
  //       best = entry;
  //     }
  //   }

  //   return best?.result ?? results[0];
  // }, []);

  // const submitFrame = useCallback(async () => {
  //   if (submitting) return;

  //   if (!selectedDoor) {
  //     onNotice({ type: "error", text: "Hãy tạo/chọn cửa trước khi nhận diện." });
  //     return;
  //   }

  //   if (!camera.canSubmit) {
  //     return;
  //   }

  //   // Kiểm tra throttle để ngăn submit quá nhanh
  //   const now = Date.now();
  //   if (now - lastSubmitTimeRef.current < DETECTION_THROTTLE_MS) {
  //     return;
  //   }
  //   lastSubmitTimeRef.current = now;

  //   setSubmitting(true);
  //   const results: IdentifyResult[] = [];

  //   try {
  //     for (let attempt = 0; attempt < IDENTIFY_ATTEMPTS; attempt += 1) {
  //       const blob = await camera.captureBlob();
  //       if (!blob) {
  //         throw new Error("Không chụp được ảnh từ camera.");
  //       }

  //       const identifyResult = await api.identify(selectedDoor, blob);
  //       results.push(identifyResult);

  //       if (attempt < IDENTIFY_ATTEMPTS - 1) {
  //         await new Promise((resolve) => window.setTimeout(resolve, IDENTIFY_INTERVAL_MS));
  //       }
  //     }

  //     const bestResult = pickMajorityResult(results);
  //     if (bestResult) {
  //       setResult(bestResult);
  //     }
  //     onRefresh();

  //     // Reset detection để detection có thể chạy liên tục
  //     camera.resetDetection();

  //     if (clearResultTimerRef.current) {
  //       window.clearTimeout(clearResultTimerRef.current);
  //     }
  //     clearResultTimerRef.current = window.setTimeout(() => setResult(null), AUTO_CAPTURE_COOLDOWN_MS);
  //   } catch (error) {
  //     onNotice({ type: "error", text: errorMessage(error, "Không thể gửi ảnh tới backend.") });
  //   } finally {
  //     setSubmitting(false);
  //   }
  // }, [camera, clearResultTimerRef, errorMessage, IDENTIFY_ATTEMPTS, IDENTIFY_INTERVAL_MS, onNotice, onRefresh, pickMajorityResult, selectedDoor, submitting]);

  // Tự động chấm công khi phát hiện khuôn mặt ổn định (không cần chờ result clear)
  useEffect(() => {
    if (camera.canSubmit && !submitting) {
      submitFrame();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera.canSubmit]);

  const cameraFrameClass = [
    "camera-frame",
    camera.canSubmit ? "ready" : "",
    submitting ? "sending" : "",
    result?.open_door ? "allowed" : result ? "denied" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const confidencePercent = Math.round(camera.confidence * 100);
  const faceBoxStyle = camera.faceBox
    ? {
        left: `${camera.faceBox.left * 100}%`,
        top: `${camera.faceBox.top * 100}%`,
        width: `${camera.faceBox.width * 100}%`,
        height: `${camera.faceBox.height * 100}%`,
      }
    : undefined;

  return (
    <div className="kiosk-layout">
      <section className="camera-panel">
        <div className="panel camera-door-panel">
          <label className="field">
            <span>Cửa hiện tại</span>
            <select value={selectedDoor} onChange={(event) => setSelectedDoor(event.target.value)}>
              {doors.map((door) => (
                <option key={door.id} value={door.name}>
                  {door.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="camera-guidance">
          <strong>Hướng dẫn chấm công</strong>
          {!camera.faceBox ? (
            <>
              <p>📍 Hãy nhìn thẳng vào camera</p>
              <p>🔆 Đảm bảo đủ ánh sáng</p>
              <p>📐 Giữ mặt trong khung xanh</p>
              <p>⏱️ Đứng yên trong 5 giây để xác nhận</p>
            </>
          ) : (
            <>
              <p style={{ color: "#4CAF50", fontWeight: "bold" }}>✓ Khuôn mặt đã được phát hiện!</p>
              <p>Hãy đứng yên để xác nhận danh tính...</p>
              <p style={{ fontSize: "24px", color: "#2196F3", fontWeight: "bold", marginTop: "10px" }}>
                ⏳ {countdownSeconds}s
              </p>
            </>
          )}
        </div>

        <div className={cameraFrameClass}>
          <div className="camera-visual">
            <video
              ref={camera.videoRef}
              muted
              playsInline
              autoPlay
              disablePictureInPicture
              disableRemotePlayback
            />
            <canvas ref={camera.canvasRef} hidden />
            {camera.faceBox && (
              <div className={camera.canSubmit ? "face-box ready" : "face-box"} style={faceBoxStyle}>
                <span className="face-box-score">{confidencePercent}%</span>
              </div>
            )}
          </div>
          {result && (
            <div className={result.open_door ? "camera-result-overlay allowed" : "camera-result-overlay denied"}>
              {result.open_door ? <CheckCircle2 size={34} /> : <XCircle size={34} />}
              <strong>{result.open_door ? "Mở cửa" : "Từ chối"}</strong>
              <span>{result.employee_name ?? "Không xác định"}</span>
              {result.employee_code && <small>Mã nhân viên: {result.employee_code}</small>}
              {result.score !== undefined && (
                <small>
                  Độ trùng khớp: {(result.score * 100).toFixed(1)}%
                  {result.images_processed && ` (${result.images_processed} ảnh)`}
                </small>
              )}
              <p>{result.message}</p>
            </div>
          )}
        </div>

        <div className="camera-controls">
          <button
            className="primary-button accent"
            disabled
            type="button"
          >
            <Upload size={18} />
            {submitting ? "Đang gửi..." : "Đang tự động chấm công..."}
          </button>
        </div>

      </section>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function generatePrintReport(
  employees: Employee[],
  departments: Department[],
  departmentName: (id?: number | null) => string
): string {
  const departmentMap = new Map(departments.map((d) => [d.id, d.name]));
  const reportDate = new Date().toLocaleString("vi-VN");
  
  let reportHTML = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Báo cáo nhân viên</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 20px;
          color: #333;
        }
        h1 {
          text-align: center;
          color: #2c3e50;
          margin-bottom: 10px;
        }
        .report-date {
          text-align: center;
          color: #666;
          margin-bottom: 20px;
          font-size: 14px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 20px;
        }
        th {
          background-color: #34495e;
          color: white;
          padding: 12px;
          text-align: left;
          border: 1px solid #bdc3c7;
        }
        td {
          padding: 10px;
          border: 1px solid #bdc3c7;
        }
        tr:nth-child(even) {
          background-color: #ecf0f1;
        }
        .status-active {
          color: green;
          font-weight: bold;
        }
        .status-inactive {
          color: red;
          font-weight: bold;
        }
        .summary {
          margin-top: 30px;
          padding: 15px;
          background-color: #ecf0f1;
          border-radius: 4px;
        }
        .summary-item {
          margin: 8px 0;
        }
        @media print {
          body { margin: 0; }
        }
      </style>
    </head>
    <body>
      <h1>Báo cáo danh sách nhân viên</h1>
      <div class="report-date">Ngày in: ${reportDate}</div>
      
      <table>
        <thead>
          <tr>
            <th>STT</th>
            <th>Mã NV</th>
            <th>Họ tên</th>
            <th>Phòng ban</th>
            <th>Vai trò</th>
            <th>Trạng thái</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  employees.forEach((emp, idx) => {
    const statusClass = emp.is_active ? "status-active" : "status-inactive";
    const statusText = emp.is_active ? "Đang hoạt động" : "Đã khóa";
    reportHTML += `
      <tr>
        <td>${idx + 1}</td>
        <td>${emp.employee_code}</td>
        <td>${emp.full_name}</td>
        <td>${departmentName(emp.department_id)}</td>
        <td>${emp.role ?? "user"}</td>
        <td><span class="${statusClass}">${statusText}</span></td>
      </tr>
    `;
  });
  
  reportHTML += `
        </tbody>
      </table>
      
      <div class="summary">
        <div class="summary-item"><strong>Tổng số nhân viên được in:</strong> ${employees.length}</div>
        <div class="summary-item"><strong>Nhân viên đang hoạt động:</strong> ${employees.filter((e) => e.is_active).length}</div>
        <div class="summary-item"><strong>Nhân viên đã khóa:</strong> ${employees.filter((e) => !e.is_active).length}</div>
      </div>
    </body>
    </html>
  `;
  
  return reportHTML;
}

function EmployeesPage({
  employees,
  departments,
  onNotice,
  onRefresh,
}: {
  employees: Employee[];
  departments: Department[];
  onNotice: (notice: Notice) => void;
  onRefresh: () => void;
}) {
  const [query, setQuery] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Employee[]>(employees);

  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<Set<number>>(new Set());
  const [selectedEmployeeForPhotos, setSelectedEmployeeForPhotos] = useState<Employee | null>(null);
  const [employeePhotos, setEmployeePhotos] = useState<string[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string>("");
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  useEffect(() => setRows(employees), [employees]);

  const [isLoading, setIsLoading] = useState(false);

  const search = async (event?: FormEvent) => {
      if (event) event.preventDefault();
      
      setIsLoading(true);
      try {
        const results = await api.searchEmployeesAdvanced({
          query: query.trim() || undefined,
          department_id: departmentFilter ?? undefined,
          is_active: statusFilter ?? undefined,
        });
        setRows(results);
      } catch (error) {
        onNotice({ type: "error", text: errorMessage(error, "Không thể tìm kiếm nhân viên.") });
      } finally {
        setIsLoading(false);
      }
  };

  const toggleStatus = async (employee: Employee) => {
      try {
        await api.updateEmployeeStatus(employee.id, !employee.is_active);
        onNotice({ type: "success", text: "Đã cập nhật trạng thái nhân viên." });
        await search();
      } catch (error) {
        onNotice({ type: "error", text: errorMessage(error, "Không thể cập nhật.") });
      }
  };

  const deleteEmployee = async (employee: Employee) => {
    try {
      await api.deleteEmployee(employee.id);
      onNotice({ type: "success", text: `Đã gửi yêu cầu xóa ${employee.full_name}.` });
      onRefresh();
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể xóa nhân viên.") });
    }
  };

  const departmentName = (id?: number | null) =>
    departments.find((department) => department.id === id)?.name ?? "Chưa gán";
  
  const clearFilters = () => {
    setQuery("");
    setDepartmentFilter(null);
    setStatusFilter(null);
    setRows(employees);
  };

  const toggleEmployeeSelection = (id: number) => {
    const newSelected = new Set(selectedEmployeeIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedEmployeeIds(newSelected);
  };

  const toggleAllSelection = () => {
    if (selectedEmployeeIds.size === rows.length) {
      setSelectedEmployeeIds(new Set());
    } else {
      setSelectedEmployeeIds(new Set(rows.map((emp) => emp.id)));
    }
  };

  const viewEmployeePhotos = async (employee: Employee) => {
    setSelectedEmployeeForPhotos(employee);
    setPhotosLoading(true);
    setPhotosError("");
    try {
      const result = await api.getEmployeePhotos(employee.id);
      setEmployeePhotos(result.photos);
    } catch (error) {
      setPhotosError(errorMessage(error, "Không thể tải ảnh nhân viên."));
    } finally {
      setPhotosLoading(false);
    }
  };

  const handlePhotoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedEmployeeForPhotos || !event.target.files) return;

    const files = Array.from(event.target.files);
    if (files.length === 0 || files.length > 5) {
      onNotice({ type: "error", text: "Vui lòng chọn từ 1 đến 5 ảnh." });
      return;
    }

    setUploadingPhotos(true);
    try {
      await api.updateEmployeePhotos(selectedEmployeeForPhotos.id, files);
      onNotice({ type: "success", text: "Đã cập nhật ảnh nhân viên." });
      // Reload photos
      const result = await api.getEmployeePhotos(selectedEmployeeForPhotos.id);
      setEmployeePhotos(result.photos);
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể cập nhật ảnh.") });
    } finally {
      setUploadingPhotos(false);
    }
  };

  const printReport = () => {
    if (selectedEmployeeIds.size === 0) {
      onNotice({ type: "error", text: "Vui lòng chọn ít nhất một nhân viên." });
      return;
    }

    const selectedEmployees = rows.filter((emp) => selectedEmployeeIds.has(emp.id));
    const reportContent = generatePrintReport(selectedEmployees, departments, departmentName);
    
    const printWindow = window.open("", "", "height=600,width=800");
    if (printWindow) {
      printWindow.document.write(reportContent);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 100);
    }
  };

  return (
    <section className="panel full">
      <div className="section-heading">
        <div>
          <h2>Quản lý nhân viên</h2>
        </div>
        <form className="search-box" onSubmit={(event) => void search(event)}>
          <Search size={17} />
          <input
            placeholder="Tìm tên hoặc mã NV"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
      </div>

      {/* Filter Row */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "15px", alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={departmentFilter ?? ""}
          onChange={(e) => setDepartmentFilter(e.target.value ? parseInt(e.target.value) : null)}
          style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
        >
          <option value="">-- Tất cả phòng ban --</option>
          {departments.map((dept) => (
            <option key={dept.id} value={dept.id}>
              {dept.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter === null ? "" : statusFilter ? "active" : "inactive"}
          onChange={(e) => {
            if (e.target.value === "") setStatusFilter(null);
            else if (e.target.value === "active") setStatusFilter(true);
            else setStatusFilter(false);
          }}
          style={{ padding: "8px", borderRadius: "4px", border: "1px solid #ccc" }}
        >
          <option value="">-- Tất cả trạng thái --</option>
          <option value="active">Đang hoạt động</option>
          <option value="inactive">Đã khóa</option>
        </select>

        <button
          type="button"
          onClick={() => void search({ preventDefault: () => {} } as FormEvent)}
          style={{
            padding: "8px 16px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Tìm kiếm
        </button>

        <button
          type="button"
          onClick={clearFilters}
          style={{
            padding: "8px 16px",
            backgroundColor: "#6c757d",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Xóa bộ lọc
        </button>

        <button
          type="button"
          onClick={printReport}
          style={{
            padding: "8px 16px",
            backgroundColor: "#28a745",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          <Printer size={15} />
          In báo cáo ({selectedEmployeeIds.size})
        </button>

        <span style={{ fontSize: "14px", color: "#666" }}>
          Tìm thấy: {rows.length} / {employees.length}
        </span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: "30px" }}>
                <input
                  type="checkbox"
                  checked={selectedEmployeeIds.size === rows.length && rows.length > 0}
                  onChange={toggleAllSelection}
                />
              </th>
              <th>Mã NV</th>
              <th>Họ tên</th>
              <th>Phòng ban</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((employee) => (
              <tr key={employee.id}>
                <td style={{ width: "30px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedEmployeeIds.has(employee.id)}
                    onChange={() => toggleEmployeeSelection(employee.id)}
                  />
                </td>
                <td>{employee.employee_code}</td>
                <td>{employee.full_name}</td>
                <td>{departmentName(employee.department_id)}</td>
                <td>{employee.role ?? "user"}</td>
                <td>
                  <span className={employee.is_active ? "badge success" : "badge danger"}>
                    {employee.is_active ? "Đang hoạt động" : "Đã khóa"}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button className="small-button" onClick={() => void viewEmployeePhotos(employee)} type="button">
                      <Image size={15} />
                      Xem ảnh
                    </button>
                    <button className="small-button" onClick={() => void toggleStatus(employee)} type="button">
                      <Lock size={15} />
                      {employee.is_active ? "Khóa" : "Mở"}
                    </button>
                    <button className="small-button danger" onClick={() => void deleteEmployee(employee)} type="button">
                      Xóa
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <EmptyState text="Không có nhân viên phù hợp." />}
      </div>

      {selectedEmployeeForPhotos && (
        <div className="modal-backdrop" onClick={() => setSelectedEmployeeForPhotos(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Quản lý ảnh - {selectedEmployeeForPhotos.full_name}</h3>
              <button className="icon-button" onClick={() => setSelectedEmployeeForPhotos(null)} type="button">
                ✕
              </button>
            </div>
            <div className="modal-body">
              {photosLoading ? (
                <p style={{ textAlign: "center" }}>Đang tải ảnh...</p>
              ) : photosError ? (
                <p className="inline-error">{photosError}</p>
              ) : (
                <>
                  <div style={{ marginBottom: "20px" }}>
                    <h4 style={{ marginBottom: "10px" }}>Danh sách ảnh:</h4>
                    {employeePhotos.length > 0 ? (
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: "10px" }}>
                        {employeePhotos.map((photoName, idx) => (
                          <EmployeePhotoThumbnail
                            key={idx}
                            employeeId={selectedEmployeeForPhotos.id}
                            photoName={photoName}
                          />
                        ))}
                      </div>
                    ) : (
                      <p style={{ color: "#999" }}>Không có ảnh nào.</p>
                    )}
                  </div>
                  <div style={{ borderTop: "1px solid #eee", paddingTop: "15px" }}>
                    <h4 style={{ marginBottom: "10px" }}>Cập nhật ảnh:</h4>
                    <label style={{ display: "block", marginBottom: "10px" }}>
                      <input
                        type="file"
                        multiple
                        accept="image/jpeg,image/png,image/jpg"
                        onChange={(e) => void handlePhotoUpload(e)}
                        disabled={uploadingPhotos}
                        style={{ display: "block", marginBottom: "5px" }}
                      />
                      <span style={{ fontSize: "12px", color: "#666" }}>
                        Chọn 1-5 ảnh để cập nhật (JPG/PNG)
                      </span>
                    </label>
                    {uploadingPhotos && <p>Đang tải lên...</p>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function EmployeePhotoThumbnail({
  employeeId,
  photoName,
}: {
  employeeId: number;
  photoName: string;
}) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadPhoto = async () => {
      try {
        const blob = await api.getEmployeePhoto(employeeId, photoName);
        const url = URL.createObjectURL(blob);
        setImageUrl(url);
      } catch (error) {
        console.error("Error loading photo:", error);
      } finally {
        setLoading(false);
      }
    };
    loadPhoto();
  }, [employeeId, photoName]);

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: "4px", overflow: "hidden", backgroundColor: "#f5f5f5" }}>
      {loading ? (
        <div style={{ width: "120px", height: "120px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "12px", color: "#999" }}>Tải...</span>
        </div>
      ) : imageUrl ? (
        <img src={imageUrl} alt={photoName} style={{ width: "100%", height: "120px", objectFit: "cover" }} />
      ) : (
        <div style={{ width: "120px", height: "120px", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: "12px", color: "#999" }}>Lỗi</span>
        </div>
      )}
    </div>
  );
}

function RegisterPage({
  departments,
  onNotice,
  onRefresh,
}: {
  departments: Department[];
  onNotice: (notice: Notice) => void;
  onRefresh: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const registerCamera = useTinyFaceRegister();
  const [isAutoCaptureActive, setIsAutoCaptureActive] = useState(false);
  const [captureAttempts, setCaptureAttempts] = useState(0);
  const [lastQualityIssues, setLastQualityIssues] = useState<string[]>([]);

  const totalFiles = files.length;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (totalFiles < 1 || totalFiles > 5) {
      onNotice({ type: "error", text: "Cần chọn từ 1 đến 5 ảnh khuôn mặt." });
      return;
    }

    const formData = new FormData();
    formData.append("full_name", fullName);
    formData.append("employee_code", employeeCode);
    formData.append("department_name", departmentName);
    files.forEach((file) => formData.append("files", file));

    setSubmitting(true);
    try {
      await api.registerEmployee(formData);
      setFullName("");
      setEmployeeCode("");
      setDepartmentName("");
      setFiles([]);
      registerCamera.stop();
      setIsAutoCaptureActive(false);
      onNotice({ type: "success", text: "Đã gửi đăng ký." });
      onRefresh();
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể đăng ký nhân viên.") });
    } finally {
      setSubmitting(false);
    }
  };

  const onFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    setFiles((current) => [...current, ...selectedFiles].slice(0, 5));
    event.target.value = "";
  };

  // Auto capture liên tục - không cần bấm "Chụp ảnh tiếp"
  useEffect(() => {
    let cancelled = false;
    const autoCapture = async () => {
      if (registerCamera.cameraOn && files.length < 5 && isAutoCaptureActive) {
        try {
          setCaptureAttempts((prev) => prev + 1);
          const capturedFile = await registerCamera.captureValidatedFace();
          if (!cancelled) {
            // Bớt quality check - chỉ check brightness basic
            const quality = await analyzeImageQuality(capturedFile);
            
            if (quality.isGood || captureAttempts <= 1) {
              setFiles((current) => {
                const newFiles = [...current, capturedFile].slice(0, 5);
                return newFiles;
              });
              setLastQualityIssues([]);
              setCaptureAttempts(0);
              onNotice({ type: "success", text: `✓ Ảnh ${files.length + 1}/5 tốt!` });
              // Tiếp tục capture sau 300ms
              if (files.length + 1 < 5) {
                setTimeout(() => {
                  if (!cancelled && registerCamera.cameraOn) {
                    autoCapture();
                  }
                }, 300);
              }
            } else {
              // Retry nhanh hơn - chỉ 2 lần
              setLastQualityIssues(quality.issues);
              if (captureAttempts < 2) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                if (!cancelled) {
                  autoCapture();
                }
              } else {
                onNotice({
                  type: "error",
                  text: `Ảnh chưa tốt. Thử lại...`,
                });
                setCaptureAttempts(0);
                await new Promise((resolve) => setTimeout(resolve, 500));
                if (!cancelled) {
                  autoCapture();
                }
              }
            }
          }
        } catch (error) {
          console.error("Auto capture error:", error);
          // Lỗi detection, retry nhanh
          if (!cancelled && registerCamera.cameraOn && isAutoCaptureActive) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            autoCapture();
          }
        }
      }
    };

    if (isAutoCaptureActive && registerCamera.cameraOn && files.length < 5) {
      autoCapture();
    }

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAutoCaptureActive, registerCamera.cameraOn, files.length]);

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  };

  const handleCaptureMore = () => {
    setCaptureAttempts(0);
    setLastQualityIssues([]);
    setIsAutoCaptureActive(true); // Bắt đầu auto-capture liên tục
  };

  return (
    <section className="panel form-panel">
      <div className="section-heading">
        <div>
          <h2>Đăng ký khuôn mặt</h2>
        </div>
      </div>

      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <label className="field">
          <span>Họ tên</span>
          <input value={fullName} onChange={(event) => setFullName(event.target.value)} required />
        </label>
        <label className="field">
          <span>Mã nhân viên</span>
          <input value={employeeCode} onChange={(event) => setEmployeeCode(event.target.value)} required />
        </label>
        <label className="field">
          <span>Phòng ban</span>
          <input
            list="department-suggestions"
            value={departmentName}
            onChange={(event) => setDepartmentName(event.target.value)}
            required
          />
          <datalist id="department-suggestions">
            {departments.map((department) => (
              <option key={department.id} value={department.name} />
            ))}
          </datalist>
        </label>
        <label className="field file-field">
          <span>Ảnh khuôn mặt</span>
          <input accept="image/*" multiple type="file" onChange={onFileSelect} />
          <small>{totalFiles ? `${totalFiles} ảnh đã thêm` : "Chọn hoặc chụp từ 1 đến 5 ảnh rõ mặt"}</small>
        </label>

        <section className="register-camera-panel">
          <div className="register-camera-header">
            <strong>Chụp từ camera</strong>
            <small>{registerCamera.message}</small>
            {lastQualityIssues.length > 0 && (
              <small style={{ color: "#ff6b6b", marginTop: "4px", display: "block" }}>
                ⚠️ {lastQualityIssues.join(", ")} - Đang thử lại...
              </small>
            )}
            {isAutoCaptureActive && (
              <small style={{ color: "#4dabf7", marginTop: "4px", display: "block" }}>
                🔄 Đang chụp (lần {captureAttempts})...
              </small>
            )}
          </div>

          <div className="register-camera-frame">
            <video ref={registerCamera.videoRef} muted playsInline autoPlay />
          </div>

          <div className="camera-controls register-camera-controls">
            <button className="secondary-button" onClick={() => void registerCamera.start()} type="button">
              <Camera size={18} />
              Bật camera
            </button>
            <button className="secondary-button" onClick={registerCamera.stop} type="button">
              Tắt camera
            </button>
            {registerCamera.cameraOn && !isAutoCaptureActive && (
              <button className="primary-button" onClick={handleCaptureMore} type="button">
                <Camera size={18} />
                {totalFiles > 0 ? `Chụp tiếp (${totalFiles}/5)` : "Bắt đầu chụp"}
              </button>
            )}
            {isAutoCaptureActive && (
              <button
                className="secondary-button"
                onClick={() => setIsAutoCaptureActive(false)}
                type="button"
              >
                Dừng ({totalFiles}/5)
              </button>
            )}
          </div>

          {files.length > 0 && (
            <div className="capture-file-list">
              {files.map((file, index) => (
                <article className="capture-file-chip" key={`${file.name}-${index}`}>
                  <span>{file.name}</span>
                  <button onClick={() => removeFile(index)} type="button">
                    Xóa
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <button className="primary-button" disabled={submitting} type="submit">
          <UserPlus size={18} />
          {submitting ? "Đang gửi..." : "Đăng ký nhân viên"}
        </button>
      </form>
    </section>
  );
}

function DoorsPage({
  doors,
  onNotice,
  onRefresh,
}: {
  doors: Door[];
  onNotice: (notice: Notice) => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const deleteDoor = async (door: Door) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa cửa "${door.name}"?`)) return;
    try {
      await api.deleteDoor(door.id);
      onNotice({ type: "success", text: "Đã xóa cửa/khu vực." });
      onRefresh();
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể xóa cửa/khu vực.") });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.createDoor({ name, description });
      setName("");
      setDescription("");
      onNotice({ type: "success", text: "Đã tạo cửa/khu vực." });
      onRefresh();
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể tạo cửa/khu vực.") });
    }
  };

  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Thêm cửa</h2>
          </div>
        </div>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>Tên cửa</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <label className="field">
            <span>Mô tả</span>
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <button className="primary-button" type="submit">
            <DoorOpen size={18} />
            Tạo cửa
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Danh sách cửa</h2>
            <p>Các điểm kiểm soát đang có trong database.</p>
          </div>
        </div>
        <div className="item-list">
          {doors.map((door) => (
            <article className="list-card" key={door.id}>
              <DoorOpen size={20} />
              <div>
                <strong>{door.name}</strong>
                <span>{door.description || "Không có mô tả"}</span>
              </div>
              <div className="list-card-actions">
                <button
                  className="small-button danger"
                  type="button"
                  onClick={() => void deleteDoor(door)}
                >
                  Xóa
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function DepartmentsPage({
  departments,
  onNotice,
  onRefresh,
}: {
  departments: Department[];
  onNotice: (notice: Notice) => void;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");

  const deleteDepartment = async (department: Department) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa phòng ban "${department.name}"?`)) return;
    try {
      await api.deleteDepartment(department.id);
      onNotice({ type: "success", text: "Đã xóa phòng ban." });
      onRefresh();
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể xóa phòng ban.") });
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.createDepartment(name);
      setName("");
      onNotice({ type: "success", text: "Đã tạo phòng ban." });
      onRefresh();
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể tạo phòng ban.") });
    }
  };

  return (
    <div className="two-column">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Thêm phòng ban</h2>
          </div>
        </div>
        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          <label className="field">
            <span>Tên phòng ban</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required />
          </label>
          <button className="primary-button" type="submit">
            <Building2 size={18} />
            Tạo phòng ban
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Danh sách phòng ban</h2>
            <p>Quyền của phòng ban sẽ được kế thừa khi nhân viên không có quyền riêng.</p>
          </div>
        </div>
        <div className="item-list">
          {departments.map((department) => (
            <article className="list-card" key={department.id}>
              <Building2 size={20} />
              <div>
                <strong>{department.name}</strong>
                <span>ID #{department.id}</span>
              </div>
              <div className="list-card-actions">
                <button
                  className="small-button danger"
                  type="button"
                  onClick={() => void deleteDepartment(department)}
                >
                  Xóa
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PermissionsPage({
  employees,
  departments,
  doors,
  onNotice,
}: {
  employees: Employee[];
  departments: Department[];
  doors: Door[];
  onNotice: (notice: Notice) => void;
}) {
  const [mode, setMode] = useState<"employee" | "department">("employee");
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? 0);
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? 0);
  const [doorId, setDoorId] = useState(doors[0]?.id ?? 0);
  const [startTime, setStartTime] = useState<AmPmTime>(() => parse24HourTime("08:00"));
  const [endTime, setEndTime] = useState<AmPmTime>(() => parse24HourTime("17:30"));

  useEffect(() => {
    if (!employeeId && employees[0]) setEmployeeId(employees[0].id);
    if (!departmentId && departments[0]) setDepartmentId(departments[0].id);
    if (!doorId && doors[0]) setDoorId(doors[0].id);
  }, [departmentId, departments, doorId, doors, employeeId, employees]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const start = `${to24HourTime(startTime)}:00`;
    const end = `${to24HourTime(endTime)}:00`;

    try {
      if (mode === "employee") {
        await api.setEmployeePermission(employeeId, doorId, start, end);
      } else {
        await api.setDepartmentPermission(departmentId, doorId, start, end);
      }

      onNotice({ type: "success", text: "Đã cập nhật quyền truy cập." });
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể cập nhật quyền truy cập.") });
    }
  };

  return (
    <section className="panel form-panel">
      <div className="section-heading">
        <div>
          <h2>Phân quyền ra vào</h2>
        </div>
      </div>

      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        <div className="segmented">
          <button className={mode === "employee" ? "selected" : ""} onClick={() => setMode("employee")} type="button">
            Cá nhân
          </button>
          <button
            className={mode === "department" ? "selected" : ""}
            onClick={() => setMode("department")}
            type="button"
          >
            Phòng ban
          </button>
        </div>

        {mode === "employee" ? (
          <label className="field">
            <span>Nhân viên</span>
            <select value={employeeId} onChange={(event) => setEmployeeId(Number(event.target.value))}>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.employee_code} - {employee.full_name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="field">
            <span>Phòng ban</span>
            <select value={departmentId} onChange={(event) => setDepartmentId(Number(event.target.value))}>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span>Cửa</span>
          <select value={doorId} onChange={(event) => setDoorId(Number(event.target.value))}>
            {doors.map((door) => (
              <option key={door.id} value={door.id}>
                {door.name}
              </option>
            ))}
          </select>
        </label>

        <TimeMeridiemField label="Từ giờ" value={startTime} onChange={setStartTime} />
        <TimeMeridiemField label="Đến giờ" value={endTime} onChange={setEndTime} />

        <button className="primary-button" type="submit">
          <ShieldCheck size={18} />
          Lưu quyền
        </button>
      </form>
    </section>
  );
}

function HistoryPage({
  history,
  employees,
  doors,
  session,
}: {
  history: AttendanceLog[];
  employees: Employee[];
  doors: Door[];
  session: AppSession;
}) {
  const isSelfView = session.role === "user";
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [doorFilter, setDoorFilter] = useState("ALL");
  const [employeeFilter, setEmployeeFilter] = useState(
    isSelfView && session.employeeId ? String(session.employeeId) : "ALL",
  );

  const [selectedLog, setSelectedLog] = useState<AttendanceLog | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const scopedHistory = history.filter((item) => {
    if (isSelfView && session.employeeId) {
      return item.employee_id === session.employeeId;
    }
    return true;
  });

  const filteredHistory = scopedHistory.filter((item) => {
    const itemDate = toDateInputValue(item.checkin_at);
    if (fromDate && itemDate < fromDate) return false;
    if (toDate && itemDate > toDate) return false;
    if (statusFilter !== "ALL" && item.status !== statusFilter) return false;
    if (doorFilter !== "ALL" && String(item.door_id ?? "") !== doorFilter) return false;
    if (!isSelfView && employeeFilter !== "ALL" && String(item.employee_id ?? "") !== employeeFilter) return false;
    return true;
  });

  const successCount = filteredHistory.filter((item) => item.status === "SUCCESS").length;
  const deniedCount = filteredHistory.filter((item) => item.status === "DENIED").length;
  const workDays = countDistinctDays(filteredHistory);
  const selectedEmployee =
    session.employeeId && isSelfView
      ? employees.find((employee) => employee.id === session.employeeId) ?? null
      : null;

  const employeeName = (id: number | null) => {
    if (isSelfView && id === session.employeeId) return session.displayName;
    return employees.find((employee) => employee.id === id)?.full_name ?? "Người lạ";
  };
  const doorName = (id: number | null) => doors.find((door) => door.id === id)?.name ?? "Không xác định";
  const resetFilters = () => {
    setFromDate("");
    setToDate("");
    setStatusFilter("ALL");
    setDoorFilter("ALL");
    setEmployeeFilter(isSelfView && session.employeeId ? String(session.employeeId) : "ALL");
  };

  useEffect(() => {
    if (!selectedLog?.image_snapshot) {
      setSnapshotUrl(null);
      setSnapshotLoading(false);
      setSnapshotError(null);
      return;
    }

    let cancelled = false;
    let nextUrl: string | null = null;

    setSnapshotUrl(null);
    setSnapshotLoading(true);
    setSnapshotError(null);

    api.getAttendanceSnapshot(selectedLog.image_snapshot)
      .then((blob) => {
        if (cancelled) return;
        nextUrl = window.URL.createObjectURL(blob);
        setSnapshotUrl(nextUrl);
      })
      .catch((error) => {
        if (cancelled) return;
        setSnapshotError(errorMessage(error, "Không thể tải ảnh chấm công."));
      })
      .finally(() => {
        if (!cancelled) setSnapshotLoading(false);
      });

    return () => {
      cancelled = true;
      if (nextUrl) window.URL.revokeObjectURL(nextUrl);
    };
  }, [selectedLog?.id, selectedLog?.image_snapshot]);

  return (
    <section className="panel full">
      <div className="section-heading">
        <div>
          <h2>{isSelfView ? "Lịch sử chấm công của tôi" : "Lịch sử ra vào"}</h2>
        </div>
      </div>

      <div className="history-toolbar">
        {isSelfView && (
          <div className="history-profile user-history-profile">
            <div>
              <strong>{session.displayName}</strong>
            </div>
            <div className="history-profile-metrics">
              <article>
                <span>Ngày công</span>
                <strong>{workDays}</strong>
              </article>
              <article>
                <span>Bản ghi</span>
                <strong>{filteredHistory.length}</strong>
              </article>
            </div>
          </div>
        )}

        <div className="history-filter-bar">
          <div className="history-filter-grid">
            <label className="field">
              <span>Từ ngày</span>
              <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
            </label>
            <label className="field">
              <span>Đến ngày</span>
              <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
            </label>
            {!isSelfView && (
              <label className="field">
                <span>Nhân viên</span>
                <select value={employeeFilter} onChange={(event) => setEmployeeFilter(event.target.value)}>
                  <option value="ALL">Tất cả nhân viên</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.employee_code} - {employee.full_name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Khu vực</span>
              <select value={doorFilter} onChange={(event) => setDoorFilter(event.target.value)}>
                <option value="ALL">Tất cả cửa</option>
                {doors.map((door) => (
                  <option key={door.id} value={door.id}>
                    {door.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Trạng thái</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="ALL">Tất cả trạng thái</option>
                <option value="SUCCESS">Thành công</option>
                <option value="DENIED">Từ chối</option>
                <option value="UNKNOWN">Không xác định</option>
              </select>
            </label>
          </div>

          <div className="history-actions">
            <button className="secondary-button" onClick={resetFilters} type="button">
              Đặt lại bộ lọc
            </button>
          </div>
        </div>
      </div>

      {!isSelfView && (
        <div className="history-summary-grid">
          <article className="history-stat">
            <span>Tổng bản ghi</span>
            <strong>{filteredHistory.length}</strong>
          </article>
          <article className="history-stat">
            <span>Thành công</span>
            <strong>{successCount}</strong>
          </article>
          <article className="history-stat">
            <span>Từ chối</span>
            <strong>{deniedCount}</strong>
          </article>
          <article className="history-stat">
            <span>Ngày công</span>
            <strong>{workDays}</strong>
          </article>
        </div>
      )}

      <div className="table-wrap">
        <table className={isSelfView ? "user-history-table" : undefined}>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Cửa</th>
              <th>Trạng thái</th>
              <th>Lý do</th>
              {!isSelfView && <th>Nhân viên</th>}
              <th>Ảnh</th>
            </tr>
          </thead>
          <tbody>
            {filteredHistory.map((item) => (
              <tr className="history-row" key={item.id} onClick={() => setSelectedLog(item)}>
                <td>{formatDateTime(item.checkin_at)}</td>
                <td>{doorName(item.door_id)}</td>
                <td>
                  <StatusBadge status={item.status} />
                </td>
                <td>{item.reason ?? "-"}</td>
                {!isSelfView && <td>{employeeName(item.employee_id)}</td>}
                <td>
                  {item.image_snapshot ? (
                    <button
                      className="small-button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setSelectedLog(item);
                      }}
                      type="button"
                    >
                      Xem ảnh
                    </button>
                  ) : (
                    "-"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredHistory.length === 0 && (
          <EmptyState text={isSelfView ? "Chưa có lịch sử chấm công của bạn." : "Không tìm thấy bản ghi nào."} />
        )}
      </div>

      {selectedLog && (
        <div className="modal-backdrop" onClick={() => setSelectedLog(null)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Ảnh chấm công</h3>
              <button className="icon-button" onClick={() => setSelectedLog(null)} type="button">
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="snapshot-frame">
                {selectedLog.image_snapshot ? (
                  <>
                    {snapshotLoading && <p className="snapshot-empty">Đang tải ảnh chấm công...</p>}
                    {snapshotError && <p className="inline-error">{snapshotError}</p>}
                    {snapshotUrl && (
                      <img
                        className="snapshot-image"
                        src={snapshotUrl}
                        alt="Ảnh chấm công"
                      />
                    )}
                  </>
                ) : (
                  <p className="snapshot-empty">Không có ảnh snapshot cho bản ghi này.</p>
                )}
              </div>
              <div className="log-details">
                <p><strong>Thời gian:</strong> {formatDateTime(selectedLog.checkin_at)}</p>
                <p><strong>Cửa:</strong> {doorName(selectedLog.door_id)}</p>
                <p><strong>Trạng thái:</strong> {selectedLog.status}</p>
                {!isSelfView && <p><strong>Nhân viên:</strong> {employeeName(selectedLog.employee_id)}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function ReportsPage({
  monthlyStats,
  setMonthlyStats,
  onNotice,
}: {
  monthlyStats: MonthlyStats | null;
  setMonthlyStats: (stats: MonthlyStats) => void;
  onNotice: (notice: Notice) => void;
}) {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const reportColumns = useMemo(() => {
    if (!monthlyStats?.data.length) {
      return [];
    }

    const seen = new Set<string>();
    const orderedKeys: string[] = [];

    for (const row of monthlyStats.data) {
      for (const key of Object.keys(row)) {
        if (!seen.has(key)) {
          seen.add(key);
          orderedKeys.push(key);
        }
      }
    }

    return orderedKeys;
  }, [monthlyStats]);

  const loadStats = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setMonthlyStats(await api.getMonthlyStats(month, year));
      onNotice({ type: "success", text: "Đã tải báo cáo tháng." });
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể tải báo cáo tháng.") });
    }
  };

  return (
    <section className="panel full">
      <div className="section-heading">
        <div>
          <h2>Báo cáo chấm công</h2>
        </div>
        <form className="report-controls" onSubmit={(event) => void loadStats(event)}>
          <input min="1" max="12" type="number" value={month} onChange={(event) => setMonth(Number(event.target.value))} />
          <input min="2020" max="2100" type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} />
          <button className="secondary-button" type="submit">Tải</button>
          <a className="download-link" href={api.getExcelExportUrl(month, year)}>
            <Download size={16} />
            Excel
          </a>
        </form>
      </div>

      {monthlyStats ? (
        <>
          {monthlyStats.data.length ? (
            <div className="table-wrap report-table-wrap">
              <table className="report-table">
                <thead>
                  <tr>
                    {reportColumns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {monthlyStats.data.map((row, index) => (
                    <tr key={`${String(row.employee_id ?? "row")}-${String(row.date ?? index)}-${index}`}>
                      {reportColumns.map((column) => (
                        <td key={`${index}-${column}`}>{formatReportValue(row[column])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState text="Không có dữ liệu báo cáo trong khoảng thời gian đã chọn." />
          )}
        </>
      ) : (
        <EmptyState text="Chọn tháng/năm và bấm Tải để xem báo cáo." />
      )}
    </section>
  );
}

function normalizeBulkImportSummary(summary: BulkImportSummary | undefined, detailsCount: number): ImportLogSummary {
  return {
    success: summary?.success ?? detailsCount,
    errors: summary?.errors ?? 0,
    noImages: summary?.no_images ?? 0,
  };
}

function AdminToolsPage({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importLogs, setImportLogs] = useState<ImportLogEntry[]>([]);
  const [days, setDays] = useState(30);

  const bulkImport = async () => {
    if (!zipFile) {
      onNotice({ type: "error", text: "Hãy chọn file ZIP có metadata.json." });
      return;
    }
    try {
      setImporting(true);
      const result = await api.bulkImport(zipFile);
      const summary = normalizeBulkImportSummary(result.summary, result.details?.length ?? 0);
      const totalAdded = summary.success + summary.noImages;
      const nextLog: ImportLogEntry = {
        id: `${Date.now()}-${zipFile.name}`,
        fileName: zipFile.name,
        message: result.message,
        importedAt: new Date().toLocaleString("vi-VN", { hour12: false }),
        totalAdded,
        summary,
      };
      setImportLogs((current) => [nextLog, ...current].slice(0, 5));
      onNotice({ type: "success", text: `Đã thêm dữ liệu: ${totalAdded} nhân viên.` });
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể nhập dữ liệu hàng loạt.") });
    } finally {
      setImporting(false);
    }
  };

  const resync = async () => {
    try {
      const result = await api.resyncVectors();
      onNotice({ type: "info", text: result.message });
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể đồng bộ lại vector.") });
    }
  };

  const clearLogs = async () => {
    try {
      const result = await api.clearLogs(days);
      onNotice({ type: "info", text: result.message });
    } catch (error) {
      onNotice({ type: "error", text: errorMessage(error, "Không thể xóa lịch sử ra vào.") });
    }
  };

  return (
    <div className="admin-grid">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Nhập hàng loạt</h2>
          </div>
          <FileArchive size={22} />
        </div>
        <label className="field file-field">
          <span>File ZIP</span>
          <input accept=".zip" type="file" onChange={(event) => setZipFile(event.target.files?.[0] ?? null)} />
          <small>{zipFile?.name ?? "Chưa chọn file"}</small>
        </label>
        <button className="primary-button" disabled={importing || !zipFile} onClick={() => void bulkImport()} type="button">
          <Upload size={18} />
          {importing ? "Đang nhập..." : "Nhập dữ liệu"}
        </button>
        {importLogs.length > 0 && (
          <div className="import-log" aria-live="polite">
            <div className="import-log-title">
              <CheckCircle2 size={18} />
              <span>Log nhập dữ liệu</span>
            </div>
            <div className="import-log-list">
              {importLogs.map((log) => (
                <div className="import-log-item" key={log.id}>
                  <div>
                    <strong>Đã thêm dữ liệu: {log.totalAdded} nhân viên</strong>
                    <small>
                      {log.importedAt} - {log.fileName}
                    </small>
                  </div>
                  <p>{log.message}</p>
                  <div className="import-log-stats">
                    <span>{log.summary.success} có ảnh</span>
                    <span>{log.summary.noImages} không ảnh</span>
                    <span className={log.summary.errors > 0 ? "danger" : ""}>{log.summary.errors} lỗi</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>CSDL vector</h2>
          </div>
        </div>
        <button className="primary-button" onClick={() => void resync()} type="button">
          <RefreshCw size={18} />
          Đồng bộ lại vector
        </button>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>Xóa lịch sử ra vào</h2>
          </div>
        </div>
        <label className="field">
          <span>Xóa bản ghi cũ hơn (ngày)</span>
          <input min="1" type="number" value={days} onChange={(event) => setDays(Number(event.target.value))} />
        </label>
        <button className="secondary-button danger" onClick={() => void clearLogs()} type="button">
          Xóa lịch sử
        </button>
      </section>
    </div>
  );
}

export default App;
