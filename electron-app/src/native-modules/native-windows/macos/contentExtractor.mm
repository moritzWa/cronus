#import "contentExtractor.h"
#include <stdio.h>

// Custom Log Macro
#define MyLog(format, ...) fprintf(stderr, "%s\n", [[NSString stringWithFormat:format, ##__VA_ARGS__] UTF8String])

@implementation ContentExtractor

+ (NSString*)getWindowTitle:(CGWindowID)windowId {
    CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId);
    if (windowList) {
        NSArray *windows = (__bridge_transfer NSArray*)windowList;
        for (NSDictionary *window in windows) {
            NSString *title = window[(__bridge NSString*)kCGWindowName];
            if (title && title.length > 0) {
                CFRelease(windowList);
                return title;
            }
        }
        CFRelease(windowList);
    }
    return @"";
}

+ (NSString*)getAppTextContent:(NSString*)ownerName windowId:(CGWindowID)windowId {
    MyLog(@"🔍 Attempting to extract text from: %@", ownerName);
    
    // Different strategies for different app types
    if ([ownerName containsString:@"Code"] || [ownerName containsString:@"Cursor"] || [ownerName containsString:@"Xcode"]) {
        return [self getCodeEditorText:windowId];
    } else if ([ownerName containsString:@"Terminal"] || [ownerName containsString:@"iTerm"]) {
        return [self getTerminalText:windowId];
    } else if ([ownerName containsString:@"Mail"] || [ownerName containsString:@"Slack"] || [ownerName containsString:@"Discord"]) {
        return [self getMessagingAppText:windowId];
    } else if ([ownerName containsString:@"TextEdit"] || [ownerName containsString:@"Notes"]) {
        return [self getTextEditorContent:windowId];
    }
    
    // Generic accessibility text extraction
    return [self getGenericAccessibilityText:windowId];
}

+ (NSString*)getGenericAccessibilityText:(CGWindowID)windowId {
    @try {
        // Get the accessibility element for the window
        AXUIElementRef systemElement = AXUIElementCreateSystemWide();
        CFArrayRef windowList;
        AXUIElementCopyAttributeValues(systemElement, kAXWindowsAttribute, 0, 100, &windowList);
        
        if (windowList) {
            NSArray *windows = (__bridge NSArray *)windowList;
            
            for (id windowElement in windows) {
                AXUIElementRef window = (__bridge AXUIElementRef)windowElement;
                
                // Try to get text content from the window
                CFStringRef textContent;
                AXError result = AXUIElementCopyAttributeValue(window, kAXValueAttribute, (CFTypeRef*)&textContent);
                
                if (result == kAXErrorSuccess && textContent) {
                    NSString *text = (__bridge NSString *)textContent;
                    CFRelease(textContent);
                    CFRelease(windowList);
                    CFRelease(systemElement);
                    
                    MyLog(@"✅ Generic accessibility text extracted: %lu chars", (unsigned long)[text length]);
                    return text;
                }
                
                // Try alternative: get focused element's text
                AXUIElementRef focusedElement;
                result = AXUIElementCopyAttributeValue(window, kAXFocusedUIElementAttribute, (CFTypeRef*)&focusedElement);
                
                if (result == kAXErrorSuccess && focusedElement) {
                    result = AXUIElementCopyAttributeValue(focusedElement, kAXValueAttribute, (CFTypeRef*)&textContent);
                    
                    if (result == kAXErrorSuccess && textContent) {
                        NSString *text = (__bridge NSString *)textContent;
                        CFRelease(textContent);
                        CFRelease(focusedElement);
                        CFRelease(windowList);
                        CFRelease(systemElement);
                        
                        MyLog(@"✅ Focused element text extracted: %lu chars", (unsigned long)[text length]);
                        return text;
                    }
                    CFRelease(focusedElement);
                }
            }
            CFRelease(windowList);
        }
        CFRelease(systemElement);
    } @catch (NSException *exception) {
        MyLog(@"❌ Error extracting accessibility text: %@", exception.reason);
    }
    
    return nil;
}

+ (NSString*)getCodeEditorFallback:(CGWindowID)windowId {
    NSString *windowTitle = [self getWindowTitle:windowId];
    MyLog(@"📝 Cursor fallback with title: '%@'", windowTitle);
    
    if (windowTitle && windowTitle.length > 0) {
        // Parse useful information from the window title
        NSMutableArray *contextParts = [NSMutableArray array];
        
        // Extract filename (look for parts with file extensions)
        NSArray *titleParts = [windowTitle componentsSeparatedByString:@" "];
        for (NSString *part in titleParts) {
            if ([part containsString:@"."] && part.length > 2) {
                // Found a filename
                [contextParts addObject:[NSString stringWithFormat:@"Editing file: %@", part]];
                
                // Detect file type for additional context
                NSString *lowerPart = [part lowercaseString];
                if ([lowerPart hasSuffix:@".ts"] || [lowerPart hasSuffix:@".js"]) {
                    [contextParts addObject:@"Working on TypeScript/JavaScript code"];
                } else if ([lowerPart hasSuffix:@".mm"] || [lowerPart hasSuffix:@".m"]) {
                    [contextParts addObject:@"Working on Objective-C/Objective-C++ code"];
                } else if ([lowerPart hasSuffix:@".py"]) {
                    [contextParts addObject:@"Working on Python code"];
                } else if ([lowerPart hasSuffix:@".java"]) {
                    [contextParts addObject:@"Working on Java code"];
                } else if ([lowerPart hasSuffix:@".cpp"] || [lowerPart hasSuffix:@".cc"]) {
                    [contextParts addObject:@"Working on C++ code"];
                } else if ([lowerPart hasSuffix:@".tsx"] || [lowerPart hasSuffix:@".jsx"]) {
                    [contextParts addObject:@"Working on React/JSX code"];
                }
                break;
            }
        }
        
        // Extract project name (usually after the "—" character)
        if ([windowTitle containsString:@"—"]) {
            NSArray *projectParts = [windowTitle componentsSeparatedByString:@"—"];
            if (projectParts.count >= 2) {
                NSString *projectName = [projectParts.lastObject stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
                [contextParts addObject:[NSString stringWithFormat:@"In project: %@", projectName]];
            }
        }
        
        if (contextParts.count > 0) {
            NSString *context = [contextParts componentsJoinedByString:@". "];
            MyLog(@"📝 Generated rich context: %@", context);
            MyLog(@"📊 EXACT CHARACTER COUNT: %lu characters", (unsigned long)context.length);
            MyLog(@"📋 EXACT CONTENT: '%@'", context);
            return context;
        } else {
            // Fallback: use the full window title
            NSString *fallback = [NSString stringWithFormat:@"Working in Cursor: %@", windowTitle];
            MyLog(@"📊 FALLBACK CHARACTER COUNT: %lu characters", (unsigned long)fallback.length);
            MyLog(@"📋 FALLBACK CONTENT: '%@'", fallback);
            return fallback;
        }
    }
    
    NSString *defaultMessage = @"Working in Cursor code editor";
    MyLog(@"📊 DEFAULT CHARACTER COUNT: %lu characters", (unsigned long)defaultMessage.length);
    MyLog(@"📋 DEFAULT CONTENT: '%@'", defaultMessage);
    return defaultMessage;
}


+ (NSString*)getCodeEditorAccessibilityText:(CGWindowID)windowId {
    MyLog(@"🔍 Starting detailed Cursor accessibility extraction...");
    
    @try {
        // Get the PID for this window
        pid_t windowPid = 0;
        CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId);
        
        if (windowList) {
            NSArray *windows = (__bridge_transfer NSArray*)windowList;
            MyLog(@"🔍 Found %lu windows in list", (unsigned long)windows.count);
            
            for (NSDictionary *window in windows) {
                NSNumber *pid = window[(__bridge NSString*)kCGWindowOwnerPID];
                NSString *owner = window[(__bridge NSString*)kCGWindowOwnerName];
                MyLog(@"   Window: %@ (PID: %@)", owner, pid);
                
                if (pid && [owner isEqualToString:@"Cursor"]) {
                    windowPid = [pid intValue];
                    MyLog(@"✅ Found Cursor window with PID: %d", windowPid);
                    break;
                }
            }
        }
        
        if (windowPid == 0) {
            MyLog(@"❌ Could not find Cursor PID");
            return nil;
        }
        
        // Create accessibility element
        AXUIElementRef appElement = AXUIElementCreateApplication(windowPid);
        if (!appElement) {
            MyLog(@"❌ Could not create accessibility element for Cursor");
            return nil;
        }
        
        MyLog(@"✅ Created accessibility element for Cursor");
        
        // Try to get focused element
        AXUIElementRef focusedElement = NULL;
        AXError focusResult = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute, (CFTypeRef*)&focusedElement);
        
        MyLog(@"🎯 Focus result: %d", focusResult);
        
        if (focusResult == kAXErrorSuccess && focusedElement) {
            MyLog(@"✅ Found focused element");
            
            // Get focused element role
            CFStringRef role = NULL;
            AXError roleResult = AXUIElementCopyAttributeValue(focusedElement, kAXRoleAttribute, (CFTypeRef*)&role);
            if (roleResult == kAXErrorSuccess && role) {
                MyLog(@"🎭 Focused element role: %@", (__bridge NSString*)role);
                CFRelease(role);
            }
            
            // Try different text attributes
            NSArray *textAttributes = @[
                (__bridge NSString*)kAXValueAttribute,
                (__bridge NSString*)kAXSelectedTextAttribute,
                (__bridge NSString*)kAXTitleAttribute,
                (__bridge NSString*)kAXDescriptionAttribute,
                (__bridge NSString*)kAXHelpAttribute
            ];
            
            for (NSString *attribute in textAttributes) {
                CFStringRef textContent = NULL;
                AXError textResult = AXUIElementCopyAttributeValue(focusedElement, (__bridge CFStringRef)attribute, (CFTypeRef*)&textContent);
                
                MyLog(@"📝 Trying attribute %@: result %d", attribute, textResult);
                
                if (textResult == kAXErrorSuccess && textContent) {
                    NSString *text = (__bridge NSString*)textContent;
                    MyLog(@"✅ Got text from %@: %lu chars", attribute, (unsigned long)text.length);
                    
                    if (text && text.length > 0) {
                        MyLog(@"📖 Content preview: %@", [text length] > 100 ? [text substringToIndex:100] : text);
                        CFRelease(textContent);
                        CFRelease(focusedElement);
                        CFRelease(appElement);
                        return text;
                    }
                    CFRelease(textContent);
                }
            }
            
            CFRelease(focusedElement);
        } else {
            MyLog(@"❌ Could not get focused element");
        }
        
        CFRelease(appElement);
        MyLog(@"❌ No accessible text found in Cursor");
        
    } @catch (NSException *exception) {
        MyLog(@"💥 Exception in Cursor accessibility: %@", exception.reason);
    }
    
    return nil;
}

+ (NSString*)getTextEditorContent:(CGWindowID)windowId {
    MyLog(@"📄 Trying to extract text editor content...");
    
    // Get the PID for this window  
    pid_t windowPid = 0;
    NSString *appName = @"";
    CFArrayRef windowList = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId);
    
    if (windowList) {
        NSArray *windows = (__bridge_transfer NSArray*)windowList;
        
        for (NSDictionary *window in windows) {
            NSNumber *pid = window[(__bridge NSString*)kCGWindowOwnerPID];
            NSString *owner = window[(__bridge NSString*)kCGWindowOwnerName];
            
            if (pid && ([owner containsString:@"TextEdit"] || [owner isEqualToString:@"Notes"])) {
                windowPid = [pid intValue];
                appName = owner;
                MyLog(@"✅ Found text editor: %@ with PID: %d", owner, windowPid);
                break;
            }
        }
    }
    
    if (windowPid == 0) {
        MyLog(@"❌ Could not find text editor PID");
        return [self getGenericAccessibilityText:windowId];
    }
    
    @try {
        AXUIElementRef appElement = AXUIElementCreateApplication(windowPid);
        if (!appElement) {
            MyLog(@"❌ Could not create accessibility element for %@", appName);
            return [self getGenericAccessibilityText:windowId];
        }
        
        // Try to get focused element
        AXUIElementRef focusedElement = NULL;
        AXError focusResult = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute, (CFTypeRef*)&focusedElement);
        
        MyLog(@"🎯 %@ focus result: %d", appName, focusResult);
        
        NSString *result = nil;
        
        if (focusResult == kAXErrorSuccess && focusedElement) {
            CFStringRef textContent = NULL;
            AXError textResult = AXUIElementCopyAttributeValue(focusedElement, kAXValueAttribute, (CFTypeRef*)&textContent);
            
            if (textResult == kAXErrorSuccess && textContent) {
                NSString *text = (__bridge NSString*)textContent;
                MyLog(@"✅ %@ SUCCESS! Extracted %lu characters", appName, (unsigned long)text.length);
                MyLog(@"📊 EXACT CHARACTER COUNT: %lu characters", (unsigned long)text.length);
                MyLog(@"📋 CONTENT PREVIEW: '%@'", [text length] > 200 ? [text substringToIndex:200] : text);
                
                // Create a copy to return (important for memory management)
                result = [NSString stringWithString:text];
                
                // Clean up
                CFRelease(textContent);
            }
            CFRelease(focusedElement);
        }
        
        // Always release the app element
        CFRelease(appElement);
        
        if (result) {
            return result;
        }
        
        MyLog(@"❌ No accessible text found in %@", appName);
        
    } @catch (NSException *exception) {
        MyLog(@"💥 Exception in %@ accessibility: %@", appName, exception.reason);
    }
    
    return [self getGenericAccessibilityText:windowId];
}

+ (NSString*)getCodeEditorText:(CGWindowID)windowId {
    MyLog(@"📝 Trying specialized code editor extraction...");
    
    // Check accessibility permissions first
    BOOL accessibilityEnabled = AXIsProcessTrusted();
    MyLog(@"🔐 Accessibility permissions: %@", accessibilityEnabled ? @"GRANTED" : @"DENIED");
    
    if (!accessibilityEnabled) {
        MyLog(@"❌ Need to enable accessibility permissions:");
        MyLog(@"   Go to System Preferences > Security & Privacy > Privacy > Accessibility");
        MyLog(@"   Add this Electron app to the list");
        return [self getCodeEditorFallback:windowId];
    }
    
    NSString *accessibilityText = [self getCodeEditorAccessibilityText:windowId];
    if (accessibilityText && accessibilityText.length > 0) {
        return accessibilityText;
    }
    
    return [self getCodeEditorFallback:windowId];
}

+ (NSString*)getTerminalText:(CGWindowID)windowId {
    MyLog(@"⌨️ Trying to extract terminal text...");
    // For now, use generic accessibility - can be enhanced later
    return [self getGenericAccessibilityText:windowId];
}

+ (NSString*)getMessagingAppText:(CGWindowID)windowId {
    MyLog(@"💬 Trying to extract messaging app text...");
    // For now, use generic accessibility - can be enhanced later
    return [self getGenericAccessibilityText:windowId];
}

@end 