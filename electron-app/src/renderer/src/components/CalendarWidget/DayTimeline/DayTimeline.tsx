import { endOfDay, startOfDay } from 'date-fns'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ActivityEventSuggestion } from 'shared'
import { useAuth } from '../../../contexts/AuthContext'
import { useManualEntry } from '../../../hooks/useManualEntry'
import { useTimeSelection } from '../../../hooks/useTimeSelection'
import { hexToRgba } from '../../../lib/colors'
import {
  convertYToTime,
  getTimelineSegmentsForDay,
  type DaySegment,
  type TimeBlock
} from '../../../lib/dayTimelineHelpers'
import { trpc } from '../../../utils/trpc'
import { CreateEntryModal } from './CreateEntryModal'
import { EventSegments } from './EventSegments'
import { TimelineGrid } from './TimelineGrid'
import { TimelineOverlays } from './TimelineOverlays'

interface DayTimelineProps {
  trackedTimeBlocks: TimeBlock[]
  googleCalendarTimeBlocks: TimeBlock[]
  currentTime: Date
  dayForEntries: Date
  isToday: boolean
  isDarkMode: boolean
  selectedHour: number | null
  onHourSelect: (hour: number | null) => void
  hourHeight: number
  scrollContainerRef: React.RefObject<HTMLDivElement | null>
}

export const DayTimeline = ({
  trackedTimeBlocks,
  googleCalendarTimeBlocks,
  currentTime,
  dayForEntries,
  isToday,
  isDarkMode,
  selectedHour,
  onHourSelect,
  hourHeight,
  scrollContainerRef
}: DayTimelineProps) => {
  const currentHourRef = useRef<HTMLDivElement>(null)
  const prevHourHeightRef = useRef(hourHeight)
  const timelineContainerRef = useRef<HTMLDivElement>(null)
  const justModifiedRef = useRef(false)
  const { token, user } = useAuth()

  const [resizingState, setResizingState] = useState<{
    isResizing: boolean
    entry: DaySegment | null
    direction: 'top' | 'bottom' | null
    startY: number | null
  }>({
    isResizing: false,
    entry: null,
    direction: null,
    startY: null
  })

  const [movingState, setMovingState] = useState<{
    isMoving: boolean
    entry: DaySegment | null
    startY: number | null
    initialTop: number | null
    hasMoved: boolean
  }>({
    isMoving: false,
    entry: null,
    startY: null,
    initialTop: null,
    hasMoved: false
  })

  const [previewState, setPreviewState] = useState<{
    top: number
    height: number
    backgroundColor: string
    hasOverlappingCalendarEvents: boolean
  } | null>(null)

  const {
    modalState,
    handleModalClose,
    handleModalSubmit,
    handleModalDelete,
    handleSelectManualEntry,
    openNewEntryModal,
    updateManualEntry
  } = useManualEntry({ baseDate: dayForEntries, onModalClose: () => resetDragState() })

  const {
    dragState,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    resetDragState
  } = useTimeSelection(
    timelineContainerRef as React.RefObject<HTMLDivElement>,
    (y: number) => {
      if (!timelineContainerRef.current) return null
      // y is already relative to the timeline container, so we pass it directly
      return convertYToTime(y, timelineContainerRef.current, hourHeight)
    },
    (startTime, endTime) => {
      openNewEntryModal(startTime, endTime)
    },
    !modalState.isOpen && !resizingState.isResizing && !movingState.isMoving,
    dayForEntries
  )

  const { data: suggestions, refetch: refetchSuggestions } = trpc.suggestions.list.useQuery(
    {
      token: token || '',
      startTime: startOfDay(dayForEntries).getTime(),
      endTime: endOfDay(dayForEntries).getTime()
    },
    { enabled: !!token }
  )

  const utils = trpc.useUtils()

  const acceptSuggestion = trpc.suggestions.accept.useMutation({
    onSuccess: () => {
      // Refetch activities and suggestions
      utils.activeWindowEvents.getEventsForDateRange.invalidate()
      refetchSuggestions()
    }
  })

  const rejectSuggestion = trpc.suggestions.reject.useMutation({
    onSuccess: () => {
      refetchSuggestions()
    }
  })

  const timelineHeight = useMemo(() => {
    const rootFontSize = 16 // Assuming default 16px
    return 24 * hourHeight * rootFontSize
  }, [hourHeight])

  const trackedDaySegments = useMemo(
    () => getTimelineSegmentsForDay(trackedTimeBlocks, timelineHeight, isToday, currentTime),
    [trackedTimeBlocks, timelineHeight, isToday, currentTime]
  )

  const suggestionDaySegments = useMemo(() => {
    if (!suggestions) return []

    const suggestionTimeBlocks: TimeBlock[] = (suggestions as ActivityEventSuggestion[]).map(
      (s: ActivityEventSuggestion) => ({
        _id: s._id.toString(),
        type: 'manual',
        name: s.name,
        startTime: new Date(s.startTime),
        endTime: new Date(s.endTime),
        durationMs: new Date(s.endTime).getTime() - new Date(s.startTime).getTime(),
        description: '',
        categoryColor: s.categoryColor,
        categoryName: s.categoryName,
        isSuggestion: true,
        onAccept: (e: React.MouseEvent) => {
          e.stopPropagation()
          if (!token) return
          acceptSuggestion.mutate({ token, suggestionId: s._id })
        },
        onReject: (e: React.MouseEvent) => {
          e.stopPropagation()
          if (!token) return
          rejectSuggestion.mutate({ token, suggestionId: s._id })
        }
      })
    )
    return getTimelineSegmentsForDay(suggestionTimeBlocks, timelineHeight)
  }, [suggestions, timelineHeight, token, acceptSuggestion, rejectSuggestion])

  const googleCalendarDaySegments = useMemo(
    () => getTimelineSegmentsForDay(googleCalendarTimeBlocks, timelineHeight),
    [googleCalendarTimeBlocks, timelineHeight]
  )

  const hourlyActivity = useMemo(() => {
    const activity = new Array(24).fill(false)
    const allSegments = [...trackedDaySegments]

    if (allSegments.length === 0) return activity
    const currentHour = new Date().getHours()

    for (let hour = 0; hour < 24; hour++) {
      if (isToday && hour === currentHour && trackedTimeBlocks.length > 0) {
        activity[hour] = true
        continue
      }
      const hourStart = new Date(dayForEntries)
      hourStart.setHours(hour, 0, 0, 0)

      const hourEnd = new Date(hourStart)
      hourEnd.setHours(hour + 1)

      for (const segment of allSegments) {
        const segmentStart = new Date(segment.startTime)
        const segmentEnd = new Date(segment.endTime)

        // Check for overlap
        if (segmentStart < hourEnd && segmentEnd > hourStart) {
          activity[hour] = true
          break
        }
      }
    }
    return activity
  }, [trackedDaySegments, dayForEntries, isToday, trackedTimeBlocks])

  const hasGoogleCalendarEvents = googleCalendarDaySegments.length > 0

  const SEGMENT_TOP_OFFSET_PX = 1
  const SEGMENT_SPACING_PX = 1 // Gap between segments
  const totalSegmentVerticalSpacing = SEGMENT_TOP_OFFSET_PX + SEGMENT_SPACING_PX

  const handleResizeStart = (
    entry: DaySegment,
    direction: 'top' | 'bottom',
    e: React.MouseEvent
  ) => {
    if (modalState.isOpen || dragState.isDragging || movingState.isMoving) return
    resetDragState() // Prevent new entry drag
    e.stopPropagation()

    setResizingState({
      isResizing: true,
      entry,
      direction,
      startY: e.clientY
    })
  }

  const handleMoveStart = (entry: DaySegment, e: React.MouseEvent) => {
    if (modalState.isOpen || resizingState.isResizing || dragState.isDragging) return
    resetDragState() // Prevent new entry drag
    e.stopPropagation()

    setMovingState({
      isMoving: true,
      entry,
      startY: e.clientY,
      initialTop: entry.top,
      hasMoved: false
    })
  }

  const handleTimelineMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (resizingState.isResizing && resizingState.entry && resizingState.startY) {
      const { entry, startY, direction } = resizingState
      const deltaY = e.clientY - startY

      // Snap to nearest 5 minutes
      const minutesPerPixel = (24 * 60) / timelineHeight
      const deltaMinutes = Math.round((deltaY * minutesPerPixel) / 5) * 5
      const pixelsPerMinute = timelineHeight / (24 * 60)
      const snappedDeltaY = deltaMinutes * pixelsPerMinute

      let newTop: number
      let newHeight: number

      if (direction === 'top') {
        newTop = entry.top + snappedDeltaY
        newHeight = entry.height - snappedDeltaY
      } else {
        // 'bottom'
        newTop = entry.top
        newHeight = entry.height + snappedDeltaY
      }

      // Clamp resize
      newHeight = Math.max(5, newHeight) // Min height 5px
      if (direction === 'top') {
        newTop = Math.min(newTop, entry.top + entry.height - 5)
      }

      const hasOverlappingCalendarEvents = googleCalendarDaySegments.some((calendarSegment) => {
        const entryStart = entry.startTime.getTime()
        const entryEnd = entry.endTime.getTime()
        const calendarStart = calendarSegment.startTime.getTime()
        const calendarEnd = calendarSegment.endTime.getTime()

        return entryStart < calendarEnd && entryEnd > calendarStart
      })

      setPreviewState({
        top: newTop,
        height: newHeight,
        backgroundColor: segmentBackgroundColor(entry),
        hasOverlappingCalendarEvents
      })
    } else if (
      movingState.isMoving &&
      movingState.entry &&
      movingState.startY &&
      movingState.initialTop !== null
    ) {
      const { entry, startY, initialTop } = movingState
      const deltaY = e.clientY - startY

      // Check for movement threshold to differentiate click from drag
      if (!movingState.hasMoved && Math.abs(deltaY) > 5) {
        setMovingState((s) => ({ ...s, hasMoved: true }))
      }

      if (movingState.hasMoved) {
        const minutesPerPixel = (24 * 60) / timelineHeight
        const deltaMinutes = Math.round((deltaY * minutesPerPixel) / 5) * 5
        const pixelsPerMinute = timelineHeight / (24 * 60)
        const snappedDeltaY = deltaMinutes * pixelsPerMinute
        const newTop = initialTop + snappedDeltaY

        const hasOverlappingCalendarEvents = googleCalendarDaySegments.some((calendarSegment) => {
          const entryStart = entry.startTime.getTime()
          const entryEnd = entry.endTime.getTime()
          const calendarStart = calendarSegment.startTime.getTime()
          const calendarEnd = calendarSegment.endTime.getTime()

          return entryStart < calendarEnd && entryEnd > calendarStart
        })

        setPreviewState({
          top: newTop,
          height: entry.height,
          backgroundColor: segmentBackgroundColor(entry),
          hasOverlappingCalendarEvents
        })
      }
    } else {
      handleMouseMove(e)
    }
  }

  // Scroll to current hour when viewing today
  useEffect(() => {
    if (isToday && currentHourRef.current && scrollContainerRef.current) {
      currentHourRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [isToday, scrollContainerRef])

  // Adjust scroll position on zoom to keep the view centered
  useLayoutEffect(() => {
    const scrollElement = scrollContainerRef.current
    if (!scrollElement) return

    const prevHourHeight = prevHourHeightRef.current
    const zoomRatio = hourHeight / prevHourHeight

    if (zoomRatio !== 1) {
      const { scrollTop, clientHeight } = scrollElement
      const scrollCenter = scrollTop + clientHeight / 2
      const newScrollTop = scrollCenter * zoomRatio - clientHeight / 2
      scrollElement.scrollTop = newScrollTop
    }

    // Update ref for the next render
    prevHourHeightRef.current = hourHeight
  }, [hourHeight, scrollContainerRef])

  const handleTimelineMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    let actionTaken = false
    if (resizingState.isResizing && resizingState.entry && resizingState.startY) {
      const { entry, direction, startY } = resizingState
      actionTaken = true

      const deltaY = e.clientY - startY
      const minutesPerPixel = (24 * 60) / timelineHeight
      // Snap to nearest 5 minutes
      const deltaMinutes = Math.round((deltaY * minutesPerPixel) / 5) * 5

      let newStartTime = new Date(entry.startTime)
      let newEndTime = new Date(entry.endTime)

      if (direction === 'top') {
        newStartTime.setMinutes(newStartTime.getMinutes() + deltaMinutes)
      } else {
        // 'bottom'
        newEndTime.setMinutes(newEndTime.getMinutes() + deltaMinutes)
      }

      // Basic validation - enforce minimum 5 minute duration
      const minDurationMs = 5 * 60 * 1000; // 5 minutes
      const currentDurationMs = newEndTime.getTime() - newStartTime.getTime();
      
      if (currentDurationMs < minDurationMs) {
        if (direction === 'top') {
          newStartTime = new Date(newEndTime.getTime() - minDurationMs);
        } else {
          newEndTime = new Date(newStartTime.getTime() + minDurationMs);
        }
      }

      const durationMs = newEndTime.getTime() - newStartTime.getTime()

      if (entry._id && durationMs > 0 && token) {
        updateManualEntry.mutate({
          token,
          id: entry._id,
          startTime: newStartTime.getTime(),
          durationMs
        })
      }
    } else if (movingState.isMoving && movingState.entry && movingState.startY) {
      // Only complete the move if the mouse has actually dragged
      if (movingState.hasMoved) {
        const { entry, startY } = movingState
        actionTaken = true

        const deltaY = e.clientY - startY
        const minutesPerPixel = (24 * 60) / timelineHeight
        const deltaMinutes = Math.round((deltaY * minutesPerPixel) / 5) * 5

        const newStartTime = new Date(entry.startTime)
        newStartTime.setMinutes(newStartTime.getMinutes() + deltaMinutes)

        const durationMs = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()

        if (entry._id && token) {
          updateManualEntry.mutate({
            token,
            id: entry._id,
            startTime: newStartTime.getTime(),
            durationMs
          })
        }
      }
    }

    if (actionTaken) {
      justModifiedRef.current = true
    }

    // Reset state regardless of what happened
    setResizingState({ isResizing: false, entry: null, direction: null, startY: null })
    setMovingState({
      isMoving: false,
      entry: null,
      startY: null,
      initialTop: null,
      hasMoved: false
    })
    setPreviewState(null)
    handleMouseUp(e)
  }

  const yToTime = (y: number) => {
    if (!timelineContainerRef.current) return null
    return convertYToTime(y, timelineContainerRef.current, hourHeight)
  }

  // Calculate current time position
  const getCurrentTimePosition = () => {
    const hours = currentTime.getHours()
    return { hours }
  }

  const handleSegmentClick = (segment: DaySegment) => {
    if (justModifiedRef.current) {
      justModifiedRef.current = false
      return
    }
    if (segment.type === 'manual') {
      handleSelectManualEntry(segment)
    }
  }

  const { hours: currentHour } = getCurrentTimePosition()
  const segmentBackgroundColor = (segment: DaySegment) =>
    segment.categoryColor
      ? hexToRgba(segment.categoryColor, isDarkMode ? 0.5 : 0.3)
      : hexToRgba('#808080', isDarkMode ? 0.3 : 0.2)

  return (
    <div className="flex-1 border border-border rounded-b-lg bg-card">
      <div
        ref={timelineContainerRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleTimelineMouseMove}
        onMouseUp={handleTimelineMouseUp}
        onMouseLeave={handleMouseLeave}
        className={`relative`}
        style={{ height: timelineHeight }}
      >
        <TimelineGrid
          currentHour={currentHour}
          selectedHour={selectedHour}
          currentHourRef={currentHourRef}
          hourHeight={hourHeight}
          onHourSelect={onHourSelect}
          hourlyActivity={hourlyActivity}
        />

        <EventSegments
          daySegments={trackedDaySegments}
          selectedHour={selectedHour}
          isDarkMode={isDarkMode}
          segmentBackgroundColor={segmentBackgroundColor}
          onSegmentClick={handleSegmentClick}
          onResizeStart={handleResizeStart}
          onMoveStart={handleMoveStart}
          SEGMENT_TOP_OFFSET_PX={SEGMENT_TOP_OFFSET_PX}
          totalSegmentVerticalSpacing={totalSegmentVerticalSpacing}
          type="activity"
          layout={hasGoogleCalendarEvents ? 'split' : 'full'}
          token={token}
          dayForEntries={dayForEntries}
          googleCalendarSegments={googleCalendarDaySegments}
        />

        <EventSegments
          daySegments={suggestionDaySegments}
          selectedHour={selectedHour}
          isDarkMode={isDarkMode}
          segmentBackgroundColor={segmentBackgroundColor}
          onSegmentClick={handleSegmentClick}
          onResizeStart={handleResizeStart}
          onMoveStart={handleMoveStart}
          SEGMENT_TOP_OFFSET_PX={SEGMENT_TOP_OFFSET_PX}
          totalSegmentVerticalSpacing={totalSegmentVerticalSpacing}
          type="activity"
          layout={hasGoogleCalendarEvents ? 'split' : 'full'}
          token={token}
          dayForEntries={dayForEntries}
          googleCalendarSegments={googleCalendarDaySegments}
        />

        {hasGoogleCalendarEvents && (
          <EventSegments
            daySegments={googleCalendarDaySegments}
            selectedHour={selectedHour}
            isDarkMode={isDarkMode}
            segmentBackgroundColor={segmentBackgroundColor}
            onSegmentClick={handleSegmentClick}
            onResizeStart={handleResizeStart}
            onMoveStart={handleMoveStart}
            SEGMENT_TOP_OFFSET_PX={SEGMENT_TOP_OFFSET_PX}
            totalSegmentVerticalSpacing={totalSegmentVerticalSpacing}
            type="calendar"
            layout="split"
            token={token}
            dayForEntries={dayForEntries}
          />
        )}

        <TimelineOverlays
          previewState={previewState}
          dragState={dragState}
          yToTime={yToTime}
          isToday={isToday}
          currentTime={currentTime}
          timelineHeight={timelineHeight}
          isDragging={dragState.isDragging}
          isModalOpen={modalState.isOpen}
          hasGoogleCalendarEvents={hasGoogleCalendarEvents}
        />
      </div>
      {modalState.isOpen && (
        <CreateEntryModal
          isOpen={modalState.isOpen}
          onClose={handleModalClose}
          onSubmit={handleModalSubmit}
          onDelete={handleModalDelete}
          startTime={modalState.startTime}
          endTime={modalState.endTime}
          existingEntry={modalState.editingEntry as TimeBlock | null}
        />
      )}
    </div>
  )
}
