import { ActiveWindowDetails } from '../../../../shared/types';
import { ActiveWindowEventModel } from '../../models/activeWindowEvent';
import { CategoryModel } from '../../models/category';
import { User as UserModel } from '../../models/user';

const getProjectNameFromTitle = (title: string): string | null => {
  const parts = title.split('—');
  if (parts.length > 1) {
    return parts.pop()?.trim() || null;
  }
  return null;
};

interface HistoryResult {
  categoryId: string;
  categoryReasoning: string | null;
}

export async function checkActivityHistory(
  userId: string,
  activeWindow: Pick<ActiveWindowDetails, 'ownerName' | 'url' | 'type' | 'title'>
): Promise<HistoryResult | null> {
  try {
    const { ownerName, url, type, title } = activeWindow;

    // First, check if the app is in the user's multi-purpose list.
    // If so, we want to force a re-categorization by the LLM.
    if (ownerName) {
      const user = await UserModel.findById(userId).select('multiPurposeApps').lean();
      if (user?.multiPurposeApps?.includes(ownerName)) {
        return null;
      }
    }

    const queryCondition: any = { userId };

    // Windsurf doesn't put the project name in the title
    const isCodeEditor = (ownerName: string) =>
      ['Cursor', 'Code', 'Visual Studio Code'].includes(ownerName);

    if (url && type === 'browser') {
      // Most specific: Match by exact URL for browser activities
      queryCondition.url = url;
    } else if (type === 'browser' && title && title.trim() !== '' && (!url || url.trim() === '')) {
      // Next specific: Browser activity, no URL (or empty URL), but has a non-empty title
      // Match by ownerName AND title to distinguish between different tabs/windows of the same browser if URL is missing
      queryCondition.ownerName = ownerName;
      queryCondition.title = title;
    } else if (ownerName && isCodeEditor(ownerName) && title) {
      const projectName = getProjectNameFromTitle(title);
      if (projectName) {
        queryCondition.ownerName = ownerName;
        // Match other files from the same project
        queryCondition.title = { $regex: `— ${projectName}$`, $options: 'i' };
      } else {
        // Fallback for editor if title format is unexpected (e.g., startup screen)
        queryCondition.ownerName = ownerName;
      }
    } else {
      // Fallback: Match by ownerName only (for non-browser apps, or browsers with no URL and no distinct title)
      if (ownerName) {
        queryCondition.ownerName = ownerName;
      }
    }

    if (Object.keys(queryCondition).length === 1 && queryCondition.userId) {
      return null;
    }

    const lastEventWithSameIdentifier = await ActiveWindowEventModel.findOne(queryCondition)
      .sort({ timestamp: -1 })
      .select('categoryId categoryReasoning')
      .lean();

    if (lastEventWithSameIdentifier && lastEventWithSameIdentifier.categoryId) {
      const categoryId = lastEventWithSameIdentifier.categoryId as string;

      // Validate that the category still exists
      const categoryExists = await CategoryModel.findById(categoryId).lean();
      if (categoryExists) {
        return {
          categoryId,
          categoryReasoning: (lastEventWithSameIdentifier.categoryReasoning as string) || null,
        };
      }
    }
  } catch (error) {
    console.error('[CategorizationService] Error during history check:', error);
  }
  return null;
}
