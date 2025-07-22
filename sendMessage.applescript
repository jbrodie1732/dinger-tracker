-- sendMessage.applescript

on run argv
	set messageText to item 1 of argv
	set chatName to "Dingers only"

	tell application "Messages"
		set targetChat to first chat whose name contains chatName
		send messageText to targetChat
	end tell
end run