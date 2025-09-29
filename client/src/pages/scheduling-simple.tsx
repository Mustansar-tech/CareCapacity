import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  MapPin, Clock, Users, Calendar, CalendarDays, CheckCircle
} from "lucide-react";
import { getGenderColorClass } from "@/utils/gender-colors";
import type { DailySchedulingResult } from "@shared/schema";

export default function SchedulingSimple() {
  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  // Query the new clean Daily Scheduling API
  const { data: dailyScheduling, isLoading, error } = useQuery<DailySchedulingResult>({
    queryKey: ['/api/scheduling/daily', selectedDate],
    enabled: !!selectedDate,
    refetchOnWindowFocus: false,
  });

  // Generate date options for the past week and next week
  const dateOptions = React.useMemo(() => {
    const dates = [];
    const today = new Date();
    
    // Past 7 days and next 7 days
    for (let i = -7; i <= 7; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      const dayName = date.toLocaleDateString('en-US', { weekday: 'short' });
      const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      dates.push({
        value: dateStr,
        label: `${dayName}, ${formattedDate}`,
        isToday: i === 0
      });
    }
    
    return dates;
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass rounded-xl p-6 border border-white/20 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              Daily Scheduling
            </h1>
            <p className="text-gray-600 dark:text-gray-300">
              Employee availability and client matching based on Daily Capacity Summary
            </p>
          </div>
          <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/20">
            <CalendarDays className="w-4 h-4 mr-2" />
            Simplified View
          </Badge>
        </div>
      </div>

      {/* Date Selection */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Select Date
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Select value={selectedDate} onValueChange={setSelectedDate}>
              <SelectTrigger 
                className="w-64" 
                data-testid="select-date"
              >
                <SelectValue placeholder="Select a date" />
              </SelectTrigger>
              <SelectContent>
                {dateOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} {option.isToday && "(Today)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {selectedDate && (
              <Badge variant="outline" className="bg-green-50 dark:bg-green-900/20">
                <CheckCircle className="w-3 h-3 mr-1" />
                {selectedDate}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <Card className="glass">
          <CardContent className="p-8 text-center">
            <div className="animate-pulse">
              <div className="text-gray-600 dark:text-gray-300">
                Loading available employees for {selectedDate}...
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <Alert className="glass border-red-200 dark:border-red-800">
          <AlertDescription className="text-red-700 dark:text-red-300">
            {(error as any)?.message || 'Failed to load scheduling data'}
          </AlertDescription>
        </Alert>
      )}

      {/* Daily Scheduling Results */}
      {dailyScheduling && !isLoading && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Available Employees for {selectedDate}
              </div>
              <Badge variant="outline" className="bg-green-50 dark:bg-green-900/20">
                {dailyScheduling.totalAvailableEmployees} employees available
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dailyScheduling.employees.length > 0 ? (
              dailyScheduling.employees.map((employee, index) => (
                <Card 
                  key={employee.employeeName} 
                  className="glass border border-white/10"
                  data-testid={`employee-card-${index}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${getGenderColorClass(employee.employeeName)}`}>
                          {employee.employeeName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <h4 
                            className={`font-medium text-lg ${getGenderColorClass(employee.employeeName, true)}`}
                            data-testid={`employee-name-${index}`}
                          >
                            {employee.employeeName}
                          </h4>
                          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                            <MapPin className="w-4 h-4" />
                            <span data-testid={`employee-postcode-${index}`}>
                              {employee.postcode}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Badge variant="outline" className="bg-blue-50 dark:bg-blue-900/20">
                        Available Today
                      </Badge>
                    </div>

                    <div className="space-y-3">
                      <h5 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Best Client Matches (within 15 minutes):
                      </h5>
                      <div className="space-y-2">
                        {employee.bestClientMatches.length > 0 ? (
                          employee.bestClientMatches.map((client, clientIndex) => (
                            <div 
                              key={`${client.clientName}-${clientIndex}`} 
                              className="flex items-center justify-between p-3 rounded-lg border bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                              data-testid={`client-match-${index}-${clientIndex}`}
                            >
                              <span 
                                className="font-medium text-sm"
                                data-testid={`client-name-${index}-${clientIndex}`}
                              >
                                {client.clientName}
                              </span>
                              <Badge variant="outline" className="text-xs bg-green-100 dark:bg-green-800">
                                <Clock className="w-3 h-3 mr-1" />
                                <span data-testid={`travel-time-${index}-${clientIndex}`}>
                                  {client.travelTimeMinutes}m
                                </span>
                              </Badge>
                            </div>
                          ))
                        ) : (
                          <div 
                            className="text-sm text-gray-600 dark:text-gray-300 p-3 border rounded-lg bg-gray-50 dark:bg-gray-800"
                            data-testid={`no-clients-${index}`}
                          >
                            No clients within 15-minute travel time
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              <div 
                className="text-center p-8 text-gray-600 dark:text-gray-300"
                data-testid="no-employees-available"
              >
                <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-lg font-medium mb-2">No employees available</p>
                <p className="text-sm">
                  No employees have availability or time windows on {selectedDate}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}