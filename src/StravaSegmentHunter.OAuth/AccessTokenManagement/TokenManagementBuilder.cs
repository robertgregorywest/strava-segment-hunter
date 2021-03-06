﻿using Microsoft.Extensions.DependencyInjection;
using System;
using System.Net.Http;

namespace StravaSegmentHunter.OAuth.AccessTokenManagement
{
    /// <summary>
    /// Builder object for the token management services
    /// </summary>
    public class TokenManagementBuilder
    {
        /// <summary>
        /// The underlying service collection
        /// </summary>
        public IServiceCollection Services { get; }

        /// <summary>
        /// ctor
        /// </summary>
        /// <param name="services"></param>
        public TokenManagementBuilder(IServiceCollection services)
        {
            Services = services;
        }

        /// <summary>
        /// Configures the back-channel client
        /// </summary>
        /// <returns></returns>
        public IHttpClientBuilder ConfigureBackchannelHttpClient(Action<HttpClient> configureClient = null)
        {
            return configureClient is null
                ? Services.AddHttpClient(AuthenticationDefaults.BackChannelHttpClientName)
                : Services.AddHttpClient(AuthenticationDefaults.BackChannelHttpClientName, configureClient);
        }
    }
}