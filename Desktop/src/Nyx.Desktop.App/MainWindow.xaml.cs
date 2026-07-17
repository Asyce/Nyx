using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace Nyx_Desktop_App;

public sealed partial class MainWindow : Window
{
    private AppWindowTitleBar? _nativeTitleBar;

    public MainWindow()
    {
        InitializeComponent();
        AppWindow.SetIcon("Assets/AppIcon.ico");
        AppWindow.Resize(new SizeInt32(1280, 720));

        ConfigureTitleBar();
        RootFrame.Navigate(typeof(MainPage));
    }

    private void ConfigureTitleBar()
    {
        if (!AppWindowTitleBar.IsCustomizationSupported())
        {
            AppTitleBar.Visibility = Visibility.Collapsed;
            return;
        }

        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);

        _nativeTitleBar = AppWindow.TitleBar;
        _nativeTitleBar.ExtendsContentIntoTitleBar = true;
        AppTitleBar.Loaded += AppTitleBar_Loaded;
        AppTitleBar.SizeChanged += AppTitleBar_SizeChanged;
        AppWindow.Changed += AppWindow_Changed;
    }

    private void AppTitleBar_Loaded(object sender, RoutedEventArgs e)
    {
        UpdateTitleBarInsets();
    }

    private void AppTitleBar_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        UpdateTitleBarInsets();
    }

    private void AppWindow_Changed(AppWindow sender, AppWindowChangedEventArgs args)
    {
        UpdateTitleBarInsets();
    }

    private void UpdateTitleBarInsets()
    {
        if (_nativeTitleBar is null || AppTitleBar.XamlRoot is null)
        {
            return;
        }

        double scale = AppTitleBar.XamlRoot.RasterizationScale;
        LeftTitleBarInset.Width = new GridLength(_nativeTitleBar.LeftInset / scale);
        RightTitleBarInset.Width = new GridLength(_nativeTitleBar.RightInset / scale);
    }
}
