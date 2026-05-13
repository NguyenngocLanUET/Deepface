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
  KeyRound,
  Lock,
  LogOut,
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
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api/client";
import { useCameraGate } from "./hooks/useCameraGate";
import type {
  AttendanceLog,
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

type UserRole = "admin" | "user";

type AppSession = {
  username: string;
  displayName: string;
  role: UserRole;
  employeeId?: number;
  signedInAt: string;
};

const SESSION_STORAGE_KEY = "faceaccess-session";
const AUTO_CAPTURE_COOLDOWN_MS = 3000;

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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function toDateInputValue(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

function countDistinctDays(items: AttendanceLog[]) {
  return new Set(items.filter((item) => item.status === "SUCCESS").map((item) => toDateInputValue(item.checkin_at)))
    .size;
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

function NoticeBar({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  if (!notice) return null;
  return (
    <button className={`notice ${notice.type}`} onClick={onClose} type="button">
      {notice.text}
    </button>
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

  return String(value);
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

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const account = loginAccounts.find(
      (item) => item.username === username.trim() && item.password === password,
    );

    if (!account) {
      setError("Sai tài khoản hoặc mật khẩu.");
      return;
    }

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
      setLoading(false);
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
    setLoading(false);
  }, [session]);

  useEffect(() => {
    if (session) {
      void refreshCoreData(true);
    }
  }, [refreshCoreData, session]);

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

        <NoticeBar notice={notice} onClose={() => setNotice(null)} />

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
              <RegisterPage onNotice={setNotice} onRefresh={() => void refreshCoreData()} />
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
  const [autoCapture, setAutoCapture] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const lastSubmitAtRef = useRef(0);
  const clearResultTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedDoor && doors[0]) setSelectedDoor(doors[0].name);
  }, [doors, selectedDoor]);

  useEffect(
    () => () => {
      if (clearResultTimerRef.current) {
        window.clearTimeout(clearResultTimerRef.current);
      }
    },
    [],
  );

  const submitFrame = useCallback(
    async (source: "auto" | "manual" = "manual") => {
      if (submitting) return;

      if (!selectedDoor) {
        if (source === "manual") {
          onNotice({ type: "error", text: "Hãy tạo/chọn cửa trước khi nhận diện." });
        }
        return;
      }

      if (!camera.canSubmit) {
        if (source === "manual") {
          onNotice({ type: "info", text: "Camera chưa thấy khuôn mặt ổn định để gửi backend." });
        }
        return;
      }

      const now = Date.now();
      if (source === "auto" && now - lastSubmitAtRef.current < AUTO_CAPTURE_COOLDOWN_MS) {
        return;
      }

      lastSubmitAtRef.current = now;
      setSubmitting(true);

      const blob = await camera.captureBlob();
      if (!blob) {
        setSubmitting(false);
        if (source === "manual") {
          onNotice({ type: "error", text: "Không chụp được ảnh từ camera." });
        }
        return;
      }

      const identifyResult = await api.identify(selectedDoor, blob);
      setResult(identifyResult);
      setSubmitting(false);
      onRefresh();

      if (clearResultTimerRef.current) {
        window.clearTimeout(clearResultTimerRef.current);
      }
      clearResultTimerRef.current = window.setTimeout(() => setResult(null), AUTO_CAPTURE_COOLDOWN_MS);
    },
    [camera, onNotice, onRefresh, selectedDoor, submitting],
  );

  useEffect(() => {
    if (!autoCapture || !camera.canSubmit || submitting) return;
    void submitFrame("auto");
  }, [autoCapture, camera.canSubmit, camera.confidence, camera.stableFrames, submitFrame, submitting]);

  const cameraFrameClass = [
    "camera-frame",
    camera.canSubmit ? "ready" : "",
    submitting ? "sending" : "",
    result?.open_door ? "allowed" : result ? "denied" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const autoStatus = submitting
    ? "Đang gửi ảnh cho backend"
    : autoCapture
      ? "Tự động gửi khi thấy khuôn mặt ổn định"
      : "Đã tạm dừng gửi tự động";
  const confidencePercent = Math.round(camera.confidence * 100);
  const faceBoxStyle = camera.faceBox
    ? {
        left: `${camera.faceBox.left * 100}%`,
        top: `${camera.faceBox.top * 100}%`,
        width: `${camera.faceBox.width * 100}%`,
        height: `${camera.faceBox.height * 100}%`,
      }
    : undefined;

  const manualSubmit = () => {
    if (!selectedDoor) {
      onNotice({ type: "error", text: "Hãy tạo/chọn cửa trước khi nhận diện." });
      return;
    }
    if (!camera.canSubmit) {
      onNotice({ type: "info", text: "Camera chưa thấy khuôn mặt ổn định để gửi backend." });
      return;
    }

    void submitFrame("manual");
  };

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
              <p>{result.message}</p>
            </div>
          )}
          <div className="auto-capture-status">
            <span className={autoCapture ? "status-dot active" : "status-dot"} />
            {autoStatus}
          </div>
        </div>

        <div className="camera-controls">
          <button className="primary-button" onClick={() => void camera.start()} type="button">
            <Camera size={18} />
            Bật quét
          </button>
          <button className="secondary-button" onClick={camera.stop} type="button">
            Tắt camera
          </button>
          <button
            className={autoCapture ? "secondary-button active" : "secondary-button"}
            onClick={() => setAutoCapture((current) => !current)}
            type="button"
          >
            {autoCapture ? "Tự động: Bật" : "Tự động: Tắt"}
          </button>
          <button
            className="primary-button accent"
            disabled={submitting || !camera.canSubmit}
            onClick={manualSubmit}
            type="button"
          >
            <Upload size={18} />
            {submitting ? "Đang gửi..." : "Gửi thử"}
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
  const [rows, setRows] = useState<Employee[]>(employees);

  useEffect(() => setRows(employees), [employees]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    setRows(query.trim() ? await api.searchEmployees(query.trim()) : employees);
  };

  const toggleStatus = async (employee: Employee) => {
    await api.updateEmployeeStatus(employee.id, !employee.is_active);
    onNotice({ type: "success", text: "Đã cập nhật trạng thái nhân viên." });
    onRefresh();
  };

  const deleteEmployee = async (employee: Employee) => {
    await api.deleteEmployee(employee.id);
    onNotice({ type: "success", text: `Đã gửi yêu cầu xóa ${employee.full_name}.` });
    onRefresh();
  };

  const departmentName = (id?: number | null) =>
    departments.find((department) => department.id === id)?.name ?? "Chưa gán";

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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
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
    </section>
  );
}

function RegisterPage({
  onNotice,
  onRefresh,
}: {
  onNotice: (notice: Notice) => void;
  onRefresh: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [employeeCode, setEmployeeCode] = useState("");
  const [departmentName, setDepartmentName] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!files || files.length < 1 || files.length > 5) {
      onNotice({ type: "error", text: "Cần chọn từ 1 đến 5 ảnh khuôn mặt." });
      return;
    }

    const formData = new FormData();
    formData.append("full_name", fullName);
    formData.append("employee_code", employeeCode);
    formData.append("department_name", departmentName);
    Array.from(files).forEach((file) => formData.append("files", file));

    setSubmitting(true);
    await api.registerEmployee(formData);
    setSubmitting(false);
    setFullName("");
    setEmployeeCode("");
    setDepartmentName("");
    setFiles(null);
    onNotice({ type: "success", text: "Đã gửi đăng ký." });
    onRefresh();
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
          <input value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} required />
        </label>
        <label className="field file-field">
          <span>Ảnh khuôn mặt</span>
          <input
            accept="image/*"
            multiple
            type="file"
            onChange={(event) => setFiles(event.target.files)}
          />
          <small>{files ? `${files.length} tệp đã chọn` : "Chọn 1 đến 5 ảnh rõ mặt"}</small>
        </label>
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await api.createDoor({ name, description });
    setName("");
    setDescription("");
    onNotice({ type: "success", text: "Đã tạo cửa/khu vực." });
    onRefresh();
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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await api.createDepartment(name);
    setName("");
    onNotice({ type: "success", text: "Đã tạo phòng ban." });
    onRefresh();
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

    if (mode === "employee") {
      await api.setEmployeePermission(employeeId, doorId, start, end);
    } else {
      await api.setDepartmentPermission(departmentId, doorId, start, end);
    }

    onNotice({ type: "success", text: "Đã cập nhật quyền truy cập." });
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
              {!isSelfView && <th>Snapshot</th>}
            </tr>
          </thead>
          <tbody>
            {filteredHistory.map((item) => (
              <tr key={item.id}>
                <td>{formatDateTime(item.checkin_at)}</td>
                <td>{doorName(item.door_id)}</td>
                <td>
                  <StatusBadge status={item.status} />
                </td>
                <td>{item.reason ?? "-"}</td>
                {!isSelfView && <td>{employeeName(item.employee_id)}</td>}
                {!isSelfView && <td>{item.image_snapshot ?? "-"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {filteredHistory.length === 0 && (
          <EmptyState text={isSelfView ? "Chưa có lịch sử chấm công của bạn." : "Không tìm thấy bản ghi nào."} />
        )}
      </div>
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
    setMonthlyStats(await api.getMonthlyStats(month, year));
    onNotice({ type: "success", text: "Đã tải báo cáo tháng." });
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
          <div className="report-summary">
            <strong>{monthlyStats.total_records}</strong>
            <span>dòng dữ liệu trong tháng {monthlyStats.month}/{monthlyStats.year}</span>
          </div>
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

function AdminToolsPage({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [days, setDays] = useState(30);

  const bulkImport = async () => {
    if (!zipFile) {
      onNotice({ type: "error", text: "Hãy chọn file ZIP có metadata.json." });
      return;
    }
    const result = await api.bulkImport(zipFile);
    onNotice({ type: "success", text: result.message });
  };

  const resync = async () => {
    const result = await api.resyncVectors();
    onNotice({ type: "info", text: result.message });
  };

  const clearLogs = async () => {
    const result = await api.clearLogs(days);
    onNotice({ type: "info", text: result.message });
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
        <button className="primary-button" onClick={() => void bulkImport()} type="button">
          <Upload size={18} />
          Nhập dữ liệu
        </button>
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
