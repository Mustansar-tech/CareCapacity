export type ReportType =
  | "visitsExport"
  | "careGiverExport"
  | "careGiverAvailabilityExport"
  | "financialSummaryExport";

export interface ReportFieldConfig {
  franchise: boolean;
  area: boolean;
  startDate?: boolean;
  endDate?: boolean;
  exportType?: boolean;
  exportTemplate?: boolean;
  type?: boolean;
  status?: boolean;
  includeBankDetails?: boolean;
  careGiverMultiSelect?: boolean;
}

export interface ReportDefaults {
  leaveAreaDefault: boolean;
  selectAllCareGivers?: boolean;
  type?: string;
  status?: string;
  includeBankDetails?: boolean;
  exportType?: string;
  exportTemplate?: string;
}

export interface ReportConfig {
  key: ReportType;
  menuPath: string[];
  directUrl: string | null;
  defaults: ReportDefaults;
  fields: ReportFieldConfig;
  exportButton: {
    name: string;
  };
}

export const REPORT_CONFIGS: Record<ReportType, ReportConfig> = {
  visitsExport: {
    key: "visitsExport",
    menuPath: ["Reports", "Monitoring", "Reports", "Exports", "Visits"],
    directUrl: "/Planning/Duty/Exports/DutyExport.aspx?URLHistory=Clear&PPNav=36293",
    defaults: {
      leaveAreaDefault: true,
    },
    fields: {
      franchise: true,
      area: true,
      startDate: true,
      endDate: true,
      exportType: true,
      exportTemplate: true,
    },
    exportButton: {
      name: "btnExport",
    },
  },

  careGiverExport: {
    key: "careGiverExport",
    menuPath: ["Reports", "CAREGivers", "Exports", "CAREGivers"],
    directUrl: "/Employee/Employee/Exports/EmployeeExport.aspx?URLHistory=Clear&PPNav=53700",
    defaults: {
      leaveAreaDefault: true,
      type: "All",
      status: "Active",
      includeBankDetails: false,
      exportType: "Excel",
      exportTemplate: "CG Data Export",
    },
    fields: {
      franchise: true,
      area: true,
      type: true,
      status: true,
      includeBankDetails: true,
      exportType: true,
      exportTemplate: true,
    },
    exportButton: {
      name: "btnExport",
    },
  },

  careGiverAvailabilityExport: {
    key: "careGiverAvailabilityExport",
    menuPath: ["Reports", "CAREGivers", "Exports", "CAREGiver Availability"],
    directUrl: "/Settings/Other/Reports/ExcelReportViewer.aspx?ReportID=114&Function=Output&HideBackButton=False&removeFromUrlHistory=True&PPNav=53700",
    defaults: {
      leaveAreaDefault: true,
      selectAllCareGivers: true,
      exportType: "Excel",
      exportTemplate: "CG Availability Export",
    },
    fields: {
      startDate: true,
      endDate: true,
      franchise: true,
      area: true,
      careGiverMultiSelect: true,
      exportType: true,
      exportTemplate: true,
    },
    exportButton: {
      name: "ReportViewer",
    },
  },

  financialSummaryExport: {
    key: "financialSummaryExport",
    // Navigated via a click-through tab bar rather than a hover flyout — see the
    // special-cased handling in automation-engine.ts's navigateToExport().
    menuPath: ["Finance", "Financial", "Export"],
    directUrl: null,
    defaults: {
      leaveAreaDefault: true,
      type: "Summary",
      status: "All",
    },
    fields: {
      franchise: true,
      area: true,
      startDate: true,
      endDate: true,
      type: true,
      status: true,
    },
    exportButton: {
      name: "btnExport",
    },
  },
};

export function getReportConfig(reportType: ReportType): ReportConfig {
  const config = REPORT_CONFIGS[reportType];
  if (!config) {
    throw new Error(`Unknown report type: ${reportType}`);
  }
  return config;
}
