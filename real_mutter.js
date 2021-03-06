const Main = imports.ui.main;
const Lang = imports.lang;
const Meta = imports.gi.Meta;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Panel = imports.ui.panel;
const St = imports.gi.St;

function ShellshapeIndicator() {
	this._init.apply(this, arguments);
}

ShellshapeIndicator.prototype = {
	__proto__: PanelMenu.SystemStatusButton.prototype,
	_init: function() {
		log("this.ext = " + this.ext);
		// TODO: 'folder'?
		PanelMenu.SystemStatusButton.prototype._init.call(this, 'folder', 'Shellshape Layout');

		// create menu
		this.menuEntries = [
			{
				label: 'Floating',
				action: this._untileAll,
				// activeText: 'X'
			},
			{
				label: 'Tiled',
				action: this._tileAll,
				// activeText: 'Tiled'
			}
		];
		this.menuIndexes = {
			floating: 0,
			vertical: 1
		};

		var items = new PopupMenu.PopupMenuSection();
		for(i in this.menuEntries) {
			let itemProps = this.menuEntries[i];
			let item = new PopupMenu.PopupMenuItem(itemProps.label);
			items.addMenuItem(item);
			item.connect('activate', Lang.bind(this, function() {
				log("callback for [" + itemProps.label + "] received by " + this);
				this._setText(itemProps.label);
				itemProps.action.call(this);
			}));
		}
		this.menu.addMenuItem(items);

		this.statusLabel = new St.Label({ text: this.menuEntries[0].label });
		this.actor.set_child(this.statusLabel);

		global.screen.connect_after('workspace-switched', Lang.bind(this,this._updateIndicator));
		//TODO:
		//this.ext.connect('layout-changed', Lang.bind(this, this._updateIndicator));
	},

	toString: function() {
		return "<ShellshapeIndicator>";
	},

	_setText: function(text) {
		log("Set label text to " + text);
		this.statusLabel.set_text(text);
	},

	_updateIndicator: function(metaScreen, oldIndex, newIndex) {
		var metaWorkspace = global.screen.get_workspace_by_index(newIndex);
		log("indicator saw switch to new workspace: " + metaWorkspace);
		//TODO: extend this when we have multiple tiling layouts
		var itemProps = null;
		log("autoTile = " + this.ext.getWorkspace(metaWorkspace).autoTile);
		if(this.ext.getWorkspace(metaWorkspace).autoTile) {
			itemProps = this.menuEntries[this.menuIndexes.vertical];
		} else {
			itemProps = this.menuEntries[this.menuIndexes.floating];
		}
		this._setText(itemProps.label);
	},

	_tileAll: function() {
		this.ext.currentWorkspace().tileAll(true);
	},

	_untileAll: function() {
		this.ext.currentWorkspace().tileAll(false);
	},

};
ShellshapeIndicator.init = function(ext) {
	// return;
	log("starting ShellshapeIndicator with ext = "+ ext);
	ShellshapeIndicator.prototype.ext = ext;
	Panel.STANDARD_TRAY_ICON_ORDER.unshift('shellshape-indicator');
	Panel.STANDARD_TRAY_ICON_SHELL_IMPLEMENTATION['shellshape-indicator'] = ShellshapeIndicator;
};



function Workspace() {
	this._init.apply(this, arguments)
}
Workspace.prototype = {
	_init : function(metaWorkspace, layout, ext) {
		var self = this;
		this.autoTile = false;
		this.metaWorkspace = metaWorkspace;
		this.layout = layout;
		this.extension = ext;
		this.metaWorkspace.connect('window-added', Lang.bind(this, this.onWindowCreate));
		this.metaWorkspace.connect('window-removed', Lang.bind(this, this.onWindowRemove));
		this.metaWindows().map(Lang.bind(this, this.onWindowCreate));
	},

	tileAll : function(newFlag) {
		if(typeof(newFlag) === 'undefined') {
			newFlag = !this.autoTile;
		}
		this.autoTile = newFlag;
		this.metaWindows().map(Lang.bind(this, function(metaWindow) {
			if(this.autoTile) {
				this.layout.tile(this.extension.getWindow(metaWindow));
			} else {
				this.layout.untile(this.extension.getWindow(metaWindow));
			}
		}));
	},

	onWindowCreate: function(workspace, metaWindow) {
		if (this.isNormalWindow(metaWindow)) {
			var win = this.extension.getWindow(metaWindow);
			this.log("onWindowCreate for " + win);
			this.layout.on_window_created(win);
			//TODO: connect signals to layout.on_window_moved and on_window_resized
			// (and disconnect those signals in onWindowRemove)
			// There are 'position-changed' and 'size-changed' signals on a mutter window actor,
			// but the metaWindow doesn't seem to have a reference to its actor.
			let winSignals = [];
			// winSignals.push(metaWindow.actor.connect('position-changed', Lang.bind(this, function() {
			// 	this.layout.on_window_moved(win);
			// })));

			// winSignals.push(metaWindow.actor.connect('size-changed', Lang.bind(this, function() {
			// 	this.layout.on_window_resized(win);
			// })));
			win.workspaceSignals = winSignals;

			if(this.autoTile) {
				win.beforeRedraw(Lang.bind(this, function() { this.layout.tile(win); }));
				this.layout.tile(win);
			}
		}
	},

	log: function(desc) {
		var wins = this.metaWindows();
		log("Workspace#" + desc + " // Workspace id ??? has " + wins.length + " metaWindows: \n" + wins.map(function(w) { return " - " + w + "\n"; }));
	},

	// activate: function() { this.metaWorkspace.activate(true); },

	onWindowRemove: function(workspace, metaWindow) {
		if (this.isNormalWindow(metaWindow)) {
			var window = this.extension.getWindow(metaWindow);
			this.log("onWindowRemove for " + window);
			if(window.workspaceSignals !== undefined) {
				log("Disconnecting " + window.workspaceSignals.length + " workspace-managed signals from window");
				window.workspaceSignals.map(function(signal) { signal.disconnect(); });
			}
			this.layout.on_window_killed(window);
			this.extension.removeWindow(metaWindow);
		}
	},

	isNormalWindow: function(metaWindow) {
		// TODO: add more smarts about floating / special windows (e.g. guake)
		try {
			return metaWindow.get_window_type() == Meta.WindowType.NORMAL && (!metaWindow.is_skip_taskbar());
		} catch (e) {
			log("Failed to get window type for window " + metaWindow + ", error was: " + e);
			return false;
		}
	},

	metaWindows: function() {
		var wins = this.metaWorkspace.list_windows();
		wins = wins.filter(Lang.bind(this, this.isNormalWindow));
		return wins;
	},

	_ignore_me: null
}

function Window(metaWindow, ext) { this._init(metaWindow, ext); }
var winCount = 1;
var stack = [];

Window.cycle = function(direction) {
	if(direction == 1) {
		stack[stack.length-1].sendToBack();
	} else {
		stack[0].bringToFront();
	}
};

Window.prototype = {
	_init: function(metaWindow, ext) {
		this.metaWindow = metaWindow;
		this.ext = ext;
		this.maximized = false;
	}
	,bringToFront: function() {
		// NOOP
	}
	,is_active: function() {
		return this.ext.currentWindow() === this;
	}
	,activate: function() {
		Main.activateWindow(this.metaWindow);
	}
	,toggle_maximize: function() {
		if(this.maximized) {
			this.unmaximize();
		} else {
			this.maximize();
		}
		this.maximized = !this.maximized;
	}
	,beforeRedraw: function(func) {
		log("adding func before redraw: " + func);
		//TODO: idle seems to be the only LaterType that reliably works; but
		// it causes a visual flash. beforeRedraw would be better, but that
		// doesn't seem to be late enough in the layout cycle to move windows around
		// (which is what this hook is used for).
		Meta.later_add(
			Meta.LaterType.IDLE, //when
			func, //func
			null, //data
			null //notify
		)
	}
	,maximize: function() {
		// more like bluetile than metacity, not sure if this should be a distinct thing...
		let maximize_border = 15;
		this.unmaximize_args = [this.xpos(), this.ypos(), this.width(), this.height()];
		this.move_resize(
				this.ext.screenDimensions.offset_x + maximize_border,
				this.ext.screenDimensions.offset_y + maximize_border,
				this.ext.screenDimensions.width - maximize_border * 2,
				this.ext.screenDimensions.height - maximize_border * 2);
	}
	,moveToWorkspace: function(newIndex) {
		this.metaWindow.change_workspace_by_index(newIndex, false, global.get_current_time());
	}
	,unmaximize: function() {
		this.move_resize.apply(this, this.unmaximize_args);
	}
	,move_resize: function(x, y, w, h) {
		this.metaWindow.move_resize_frame(true, x, y, w, h);
	}
	,get_title: function() {
		return this.metaWindow.get_title();
	}
	,toString: function() {
		return ("<#Window with MetaWindow: " + this.get_title() + ">");
	}
	,width: function() { return this._outer_rect().width; }
	,height: function() { return this._outer_rect().height; }
	,xpos: function() { return this._outer_rect().x; }
	,ypos: function() { return this._outer_rect().y; }
	,_outer_rect: function() { return this.metaWindow.get_outer_rect(); }
};

