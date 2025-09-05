#import "ScreenshotManager.h"
#import <os/log.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>


// Custom Log Macro
#define MyLog(format, ...) { \
    static os_log_t log_handle = NULL; \
    if (log_handle == NULL) { \
        log_handle = os_log_create("com.cronus.app", "ScreenshotManager"); \
    } \
    NSString *log_message = [NSString stringWithFormat:format, ##__VA_ARGS__]; \
    os_log(log_handle, "%{public}s", [log_message UTF8String]); \
}

@implementation ScreenshotManager {
    NSTimer *screenshotTimer;
}

- (void)startPeriodicScreenshotCapture {
    [self stopPeriodicScreenshotCapture];
    
    // Remove the periodic timer logic
    MyLog(@"Screenshot capture will be triggered by window changes");
}

- (void)stopPeriodicScreenshotCapture {
    [screenshotTimer invalidate];
    screenshotTimer = nil;
    MyLog(@"Screenshot timer stopped");
}

- (void)takeScreenshot {
    if (!self.delegate) return;
    
    NSDictionary *windowInfo = [self.delegate getActiveWindowForScreenshotManager:self];
    if (!windowInfo) return;
    
    CGWindowID windowId = [[windowInfo objectForKey:@"id"] unsignedIntValue];
    
    // Perform OCR instead of just screenshot
    NSString *ocrText = [self.delegate captureScreenshotAndPerformOCR:windowId];
    
    // Send OCR result
    NSMutableDictionary *mutableWindowInfo = [windowInfo mutableCopy];
    mutableWindowInfo[@"content"] = ocrText ?: @"";
    mutableWindowInfo[@"contentSource"] = @"ocr";
    mutableWindowInfo[@"captureReason"] = @"periodic_backup";
    
    [self.delegate screenshotManager:self didPerformOCR:mutableWindowInfo];
    [mutableWindowInfo release];
}

- (NSData*)captureWindowScreenshot:(CGWindowID)windowId {
    CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId);
    CGRect windowBounds = CGRectNull;
    if (windowList && CFArrayGetCount(windowList) > 0) {
        CFDictionaryRef windowInfoDict = (CFDictionaryRef)CFArrayGetValueAtIndex(windowList, 0);
        CFDictionaryRef boundsDict = (CFDictionaryRef)CFDictionaryGetValue(windowInfoDict, kCGWindowBounds);
        CGRectMakeWithDictionaryRepresentation(boundsDict, &windowBounds);
    }
    if(windowList) CFRelease(windowList);

    if (CGRectIsNull(windowBounds)) {
        MyLog(@"Could not get window bounds for screenshot");
        return nil;
    }

    CGImageRef imageRef = CGWindowListCreateImage(
        CGRectNull,
        kCGWindowListOptionIncludingWindow,
        windowId,
        kCGWindowImageBoundsIgnoreFraming | kCGWindowImageNominalResolution
    );

    if (!imageRef) {
        MyLog(@"Failed to create window image.");
        return nil;
    }

    // Convert to JPEG with compression
    NSMutableData *imageData = [NSMutableData data];
    CGImageDestinationRef destination = CGImageDestinationCreateWithData((__bridge CFMutableDataRef)imageData, (CFStringRef)UTTypeJPEG.identifier, 1, NULL);

    if (!destination) {
        CGImageRelease(imageRef);
        return nil;
    }
    
    NSDictionary *properties = @{ (__bridge NSString *)kCGImageDestinationLossyCompressionQuality: @0.5 };
    CGImageDestinationAddImage(destination, imageRef, (__bridge CFDictionaryRef)properties);
    CGImageDestinationFinalize(destination);
    
    CFRelease(destination);
    CGImageRelease(imageRef);
    
    return imageData;
}

- (void)dealloc {
    [self stopPeriodicScreenshotCapture];
    [super dealloc];
}

@end 