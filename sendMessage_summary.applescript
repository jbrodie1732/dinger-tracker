-- sendMessage_summary.applescript
-- Usage:
--   osascript sendMessage_summary.applescript "Dingers only" "summary text here"

on run {targetName, targetMessage}
	tell application "Messages"
		set iService to 1st service whose service type = iMessage

		try
			-- Attempt to send to group chat by name
			set targetChat to first chat whose name contains targetName
			send targetMessage to targetChat
		on error
			-- Fallback to sending to individual buddy
			set targetBuddy to buddy targetName of iService
			send targetMessage to targetBuddy
		end try
	end tell
end run