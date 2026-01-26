import { EmployeeSummaryRecord } from "@shared/schema";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar } from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";

interface EmployeeSummaryTabProps {
  data: EmployeeSummaryRecord[];
  selectedDate: string;
  availableDates: string[];
  onDateChange: (date: string) => void;
}

export function EmployeeSummaryTab({ data, selectedDate, availableDates, onDateChange }: EmployeeSummaryTabProps) {
  if (!data || data.length === 0) {
    return (
      <Card className="h-full backdrop-blur-sm bg-white/70 dark:bg-gray-900/70 border-0 shadow-xl">
        <CardContent className="p-8">
          <div className="text-center text-gray-500 dark:text-gray-400">
            No employee summary data available for {selectedDate}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate totals
  const totals = data.reduce(
    (acc, emp) => ({
      availability: acc.availability + emp.availability,
      unavailability: acc.unavailability + emp.unavailability,
      scheduledHours: acc.scheduledHours + emp.scheduledHours,
      difference: acc.difference + (emp.difference > 0 ? emp.difference : 0),
    }),
    { availability: 0, unavailability: 0, scheduledHours: 0, difference: 0 }
  );

  return (
    <Card className="h-full backdrop-blur-sm bg-white/70 dark:bg-gray-900/70 border-0 shadow-xl">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/50 dark:to-purple-950/50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl font-semibold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Employee Summary
          </CardTitle>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <Select value={selectedDate} onValueChange={onDateChange}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select date" />
              </SelectTrigger>
              <SelectContent>
                {(availableDates || [])
                  .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())
                  .map((date) => (
                  <SelectItem key={date} value={date}>
                    {new Date(date).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    }).replace(/(\w{3}) (\w{3}) (\d+), (\d{4})/, '$1, $2 $3, $4')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          Consolidated view showing contracted daily hours, unavailability, scheduled hours, and capacity differences
        </p>
      </CardHeader>
      <CardContent className="p-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 border-green-200 dark:border-green-800">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                {totals.availability.toFixed(1)}
              </div>
              <div className="text-sm text-green-600 dark:text-green-400">Total Desired Hours</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-red-50 to-pink-50 dark:from-red-950/50 dark:to-pink-950/50 border-red-200 dark:border-red-800">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-700 dark:text-red-300">
                {totals.unavailability.toFixed(1)}
              </div>
              <div className="text-sm text-red-600 dark:text-red-400">Total Unavailable</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/50 dark:to-cyan-950/50 border-blue-200 dark:border-blue-800">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                {totals.scheduledHours.toFixed(1)}
              </div>
              <div className="text-sm text-blue-600 dark:text-blue-400">Total Scheduled Hours</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/50 dark:to-emerald-950/50 border-green-200 dark:border-green-800">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-700 dark:text-green-300">
                +{totals.difference.toFixed(1)}
              </div>
              <div className="text-sm text-green-600 dark:text-green-400">
                Capacity
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Employee Table */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <Table>
            <TableHeader className="bg-gray-50 dark:bg-gray-800/50">
              <TableRow>
                <TableHead className="font-semibold">Name</TableHead>
                <TableHead className="text-center font-semibold">Desired Hours</TableHead>
                <TableHead className="text-center font-semibold">Unavailability</TableHead>
                <TableHead className="text-center font-semibold">Scheduled Hours</TableHead>
                <TableHead className="text-center font-semibold">Difference</TableHead>
                {/* Hidden columns - Free Windows and Cancelled Visits */}
                {false && <TableHead className="text-center font-semibold">Free Windows</TableHead>}
                {false && <TableHead className="text-center font-semibold">Cancelled Visits</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((employee, index) => (
                <TableRow 
                  key={employee.employeeName} 
                  className={index % 2 === 0 ? "bg-gray-50/50 dark:bg-gray-800/30" : "bg-white dark:bg-gray-900/30"}
                  data-testid={`row-employee-summary-${index}`}
                >
                  <TableCell className="font-medium" data-testid={`text-employee-name-${index}`}>
                    <span className={getGenderColorClass(employee.gender)}>
                      {employee.employeeName}
                    </span>
                  </TableCell>
                  <TableCell className="text-center" data-testid={`text-availability-${index}`}>
                    <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300">
                      {employee.availability.toFixed(1)}h
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center" data-testid={`text-unavailability-${index}`}>
                    <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300">
                      {employee.unavailability.toFixed(1)}h
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center" data-testid={`text-scheduled-hours-${index}`}>
                    <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                      {employee.scheduledHours.toFixed(1)}h
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center" data-testid={`text-difference-${index}`}>
                    <Badge 
                      variant="secondary" 
                      className={
                        employee.difference === 0
                          ? "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300"
                          : employee.difference > 0 
                          ? "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300"
                          : "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300"
                      }
                    >
                      {employee.difference > 0 ? '+' : ''}{employee.difference.toFixed(1)}h
                    </Badge>
                  </TableCell>
                  {/* Hidden columns - Free Windows and Cancelled Visits */}
                  {false && <TableCell className="text-center" data-testid={`text-free-windows-${index}`}>
                    {employee.freeWindows ? (
                      <Badge variant="outline" className="bg-purple-50 text-purple-800 dark:bg-purple-900/50 dark:text-purple-300 text-xs font-mono">
                        {employee.freeWindows}
                      </Badge>
                    ) : (
                      <span className="text-gray-400 text-sm">None</span>
                    )}
                  </TableCell>}
                  {false && <TableCell className="text-center" data-testid={`text-cancelled-visits-${index}`}>
                    {employee.cancelledVisits && employee.cancelledVisits !== '—' ? (
                      <Badge variant="outline" className="bg-red-50 text-red-800 dark:bg-red-900/50 dark:text-red-300 text-xs font-mono max-w-xs break-words">
                        {employee.cancelledVisits}
                      </Badge>
                    ) : (
                      <span className="text-gray-400 text-sm">None</span>
                    )}
                  </TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          <p><strong>Difference</strong> = Availability - Unavailability - Scheduled Hours</p>
          <p>Positive values indicate excess capacity, negative values indicate potential shortages.</p>
        </div>
      </CardContent>
    </Card>
  );
}