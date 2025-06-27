import { ActiveWindowEvent, Category } from 'shared'
import type { ProcessedEventBlock } from '../components/DashboardView'
import { MAX_GAP_BETWEEN_EVENTS_MS, SYSTEM_EVENT_NAMES } from '../lib/constants'

export function generateProcessedEventBlocks(
  events: ActiveWindowEvent[],
  categories: Category[]
): ProcessedEventBlock[] {
  const chronologicallySortedEvents = [...events]
    .filter((event) => typeof event.timestamp === 'number')
    .sort((a, b) => (a.timestamp as number) - (b.timestamp as number))

  const categoriesMap = new Map<string, Category>(categories.map((cat) => [cat._id, cat]))
  const blocks: ProcessedEventBlock[] = []

  for (let i = 0; i < chronologicallySortedEvents.length; i++) {
    const event = chronologicallySortedEvents[i]
    if (
      SYSTEM_EVENT_NAMES.includes(event.ownerName) ||
      (!event.categoryId && event.type !== 'manual')
    ) {
      continue
    }

    const eventStartTime = new Date(event.timestamp as number)
    let eventEndTime: Date
    let eventDurationMs: number

    if (event.type === 'manual' && event.durationMs) {
      eventDurationMs = event.durationMs
      eventEndTime = new Date(eventStartTime.getTime() + eventDurationMs)

      // Debug logging for manual entries
      if (event.ownerName === 'Commuting' || event.ownerName.includes('test long event')) {
        console.log('Processing manual entry in eventProcessing.ts:', {
          name: event.ownerName,
          originalDurationMs: event.durationMs,
          calculatedDurationMs: eventDurationMs,
          startTime: eventStartTime,
          endTime: eventEndTime
        })
      }
    } else if (i < chronologicallySortedEvents.length - 1) {
      const nextEventTime = new Date(
        chronologicallySortedEvents[i + 1].timestamp as number
      ).getTime()
      eventDurationMs = nextEventTime - eventStartTime.getTime()
      if (eventDurationMs > MAX_GAP_BETWEEN_EVENTS_MS) {
        eventDurationMs = MAX_GAP_BETWEEN_EVENTS_MS
      }
      eventEndTime = new Date(eventStartTime.getTime() + eventDurationMs)
    } else {
      const now = new Date()
      const potentialEndTime = new Date(eventStartTime.getTime() + MAX_GAP_BETWEEN_EVENTS_MS)
      eventEndTime = now < potentialEndTime ? now : potentialEndTime
      eventDurationMs = eventEndTime.getTime() - eventStartTime.getTime()
    }

    const category = event.categoryId ? categoriesMap.get(event.categoryId) : undefined
    blocks.push({
      startTime: eventStartTime,
      endTime: eventEndTime,
      durationMs: eventDurationMs,
      name: event.ownerName,
      title: event.title || undefined,
      url: event.url || undefined,
      categoryId: event.categoryId,
      categoryName: category?.name,
      categoryColor: category?.color,
      isProductive: category?.isProductive,
      originalEvent: event
    })
  }
  return blocks
}
